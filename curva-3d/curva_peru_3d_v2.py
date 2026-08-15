"""
============================================================================
 SUPERFICIE 3D — CURVA SOBERANA PERUANA (BTP)
----------------------------------------------------------------------------
 FORMATO DE ENTRADA (el nuevo):
   Fila 1 : DATE | 12/08/2026 | 12/08/2028 | ... | 12/08/2055   <- vencimientos
   Fila 2+: fecha | tasas de rendimiento (YTM %)  |  '#N/D' donde no cotiza

 Ejes:  X = plazo residual (años)   Y = fecha   Z = YTM (%)

 Librerías:  pip install pandas numpy scipy plotly openpyxl
============================================================================
"""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from scipy.interpolate import PchipInterpolator
from scipy.optimize import least_squares

# ===========================================================================
# 1) CONFIGURACIÓN
# ===========================================================================

RUTA_EXCEL  = "Tasas_curvas_v2.xlsx"
HOJA        = 0
SALIDA_HTML = "curva_peru_3d.html"

METODO   = "pchip"     # "pchip" = interpola solo donde hay bonos
                       # "ns"    = Nelson-Siegel (rellena y suaviza la curva)

GRID = np.array([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30])

FRECUENCIA  = "W-FRI"  # "B" diario · "W-FRI" semanal · "ME" fin de mes
MIN_PUNTOS  = 4        # mínimo de bonos vivos ese día para dibujar la curva
TENOR_MIN   = 0.25     # descarta el bono que está por vencer (YTM ruidoso)
EXTRAPOLAR  = False    # True = extiende plana la curva fuera del rango observado
SOLO_EN_RANGO = True   # deja hueco donde ese día no había bonos (recomendado)
SUAVIZADO   = 3        # media móvil sobre el eje tiempo (0 = apagado)
RESALTAR    = True     # curva más reciente en negro


# ===========================================================================
# 2) CARGA  —  manejo de los #N/D
# ===========================================================================

def cargar(ruta=RUTA_EXCEL, hoja=HOJA):
    """
    Devuelve (fechas, vencimientos, matriz de YTM).

    Los '#N/D' se convierten en NaN, NO en cero. Un cero sería un dato
    falso: el motor de interpolación lo leería como un bono cotizando a
    0.00% y te hundiría la superficie hasta el piso en toda la zona donde
    el bono aún no había sido emitido. NaN significa "no existe" y queda
    fuera del ajuste de cada día.
    """
    df = pd.read_excel(ruta, sheet_name=hoja, header=0)
    df = df.rename(columns={df.columns[0]: "DATE"})

    # --- eje temporal ---
    if np.issubdtype(df["DATE"].dtype, np.number):
        df["DATE"] = pd.to_datetime(df["DATE"], unit="D", origin="1899-12-30")
    else:
        df["DATE"] = pd.to_datetime(df["DATE"], dayfirst=True, errors="coerce")
    df = df.dropna(subset=["DATE"]).set_index("DATE").sort_index()

    # --- encabezados = fechas de vencimiento ---
    vencs = pd.to_datetime([str(c) for c in df.columns], dayfirst=True,
                           errors="coerce")
    if vencs.isna().any():
        malos = [c for c, v in zip(df.columns, vencs) if pd.isna(v)]
        raise ValueError(f"Encabezados que no son fecha: {malos}")
    df.columns = vencs

    # --- '#N/D', '#N/A', texto, celdas vacías -> NaN ---
    df = df.apply(pd.to_numeric, errors="coerce")
    df = df.dropna(how="all")

    n_na = int(df.isna().sum().sum())
    print(f"Cargado: {df.index.min():%d-%b-%Y} a {df.index.max():%d-%b-%Y} | "
          f"{df.shape[0]} días x {df.shape[1]} bonos | "
          f"{n_na} celdas sin dato (excluidas, no puestas en cero)")
    return df


# ===========================================================================
# 3) PANEL LARGO: (fecha, plazo residual, ytm)
# ===========================================================================

def construir_panel(df):
    """
    Cada bono rueda hacia el corto plazo con el tiempo: el plazo se
    recalcula día a día como (vencimiento - fecha). Por eso el eje X es
    tenor y no "bono": si se graficara por bono la superficie quedaría
    deformada por el roll-down.
    """
    largo = df.stack(future_stack=True).rename("ytm").reset_index()
    largo.columns = ["fecha", "venc", "ytm"]
    largo = largo.dropna(subset=["ytm"])                    # aquí mueren los N/D
    largo["tenor"] = (largo["venc"] - largo["fecha"]).dt.days / 365.25
    return largo[largo["tenor"] >= TENOR_MIN].reset_index(drop=True)


# ===========================================================================
# 4) AJUSTE DE LA CURVA DIARIA
# ===========================================================================

def _ns(t, b0, b1, b2, lam):
    """Nelson-Siegel (1987)."""
    t = np.maximum(t, 1e-6)
    x = t / lam
    f = (1 - np.exp(-x)) / x
    return b0 + b1 * f + b2 * (f - np.exp(-x))


def ajustar_ns(x, y, grid):
    p0 = [y[-1], y[0] - y[-1], 0.0, 2.0]
    try:
        r = least_squares(lambda p: _ns(x, *p) - y, p0,
                          bounds=([-30, -30, -30, 0.05], [30, 30, 30, 15]),
                          max_nfev=400)
        return _ns(grid, *r.x)
    except Exception:
        return np.full(len(grid), np.nan)


def ajustar_dia(sub, grid=GRID):
    sub = sub.sort_values("tenor").drop_duplicates("tenor")
    if len(sub) < MIN_PUNTOS:
        return np.full(len(grid), np.nan)
    x, y = sub["tenor"].to_numpy(), sub["ytm"].to_numpy()

    if METODO == "ns":
        z = ajustar_ns(x, y, grid)
    else:
        z = PchipInterpolator(x, y, extrapolate=False)(grid)

    fuera = (grid < x[0]) | (grid > x[-1])
    if SOLO_EN_RANGO:
        z = np.where(fuera, np.nan, z)      # no se inventa lo que no cotizó
    elif EXTRAPOLAR:
        z = np.where(grid < x[0], y[0], z)
        z = np.where(grid > x[-1], y[-1], z)
    return z


def construir_superficie(panel):
    fechas = pd.DatetimeIndex(sorted(panel["fecha"].unique()))
    sel = pd.Series(fechas, index=fechas).resample(FRECUENCIA).last().dropna()
    sel = pd.DatetimeIndex(sel.values)

    sub = panel[panel["fecha"].isin(sel)]
    Z, idx = [], []
    for f, g in sub.groupby("fecha"):
        Z.append(ajustar_dia(g))
        idx.append(f)

    Z = pd.DataFrame(Z, index=pd.DatetimeIndex(idx), columns=GRID).dropna(how="all")
    if SUAVIZADO and SUAVIZADO > 1:
        Z = Z.rolling(SUAVIZADO, min_periods=1, center=True).mean()

    cob = 100 * Z.notna().mean()
    print("Cobertura por plazo (%):",
          " ".join(f"{t:g}a={c:.0f}" for t, c in cob.items()))
    return Z


# ===========================================================================
# 5) GRÁFICO 3D
# ===========================================================================

def graficar(Z, salida=SALIDA_HTML):
    fechas = Z.index
    y = np.arange(len(fechas))
    X, Y = np.meshgrid(GRID, y)

    txt = np.array([[f"{d:%d-%b-%Y}<br>Plazo {t:g}a<br>YTM {v:.3f}%"
                     for t, v in zip(GRID, fila)]
                    for d, fila in zip(fechas, Z.values)])

    fig = go.Figure(go.Surface(
        x=X, y=Y, z=Z.values, text=txt, hoverinfo="text",
        colorscale=[[0.0, "#16365c"], [0.30, "#3d6fa8"], [0.55, "#9fb8d4"],
                    [0.72, "#dcc4ae"], [0.88, "#d98d5a"], [1.0, "#a8322a"]],
        colorbar=dict(title="YTM %", thickness=14, len=0.55),
        contours=dict(z=dict(show=True, color="rgba(255,255,255,0.22)",
                             width=1, start=0, end=12, size=0.5)),
        lighting=dict(ambient=0.78, diffuse=0.75, specular=0.04),
        connectgaps=False,          # los huecos se ven como huecos
    ))

    if RESALTAR:
        u = Z.iloc[-1].dropna()
        fig.add_trace(go.Scatter3d(
            x=u.index.to_numpy(), y=np.full(len(u), y[-1]), z=u.to_numpy(),
            mode="lines+markers", line=dict(color="black", width=7),
            marker=dict(size=3, color="black"),
            name=f"{fechas[-1]:%d-%b-%Y}",
            hovertemplate="Plazo %{x:.0f}a · YTM %{z:.3f}%<extra></extra>"))

    ticks = [i for i, d in enumerate(fechas) if i == 0 or d.year != fechas[i-1].year]
    u = Z.iloc[-1]
    sub = ""
    if np.isfinite(u.get(10, np.nan)) and np.isfinite(u.get(2, np.nan)):
        sub = f"  ·  10A {u[10]:.2f}%  ·  10A-2A {100*(u[10]-u[2]):+.0f} pbs"

    fig.update_layout(
        title=dict(x=0.5, text="<b>Curva Soberana Perú (BTP) — superficie 3D</b>"
                   f"<br><sup>{fechas[0]:%b-%Y} – {fechas[-1]:%d-%b-%Y}"
                   f"  ·  método: {METODO.upper()}{sub}</sup>"),
        scene=dict(
            xaxis=dict(title="Plazo residual (años)", tickvals=GRID,
                       backgroundcolor="#f6f8fb", gridcolor="#dae1ea"),
            yaxis=dict(title="Fecha", tickvals=ticks,
                       ticktext=[f"{fechas[i]:%Y}" for i in ticks],
                       backgroundcolor="#f6f8fb", gridcolor="#dae1ea"),
            zaxis=dict(title="YTM (%)", backgroundcolor="#f6f8fb",
                       gridcolor="#dae1ea"),
            camera=dict(eye=dict(x=1.85, y=-1.75, z=0.80)),
            aspectratio=dict(x=1.0, y=2.0, z=0.55)),
        template="plotly_white", height=800,
        margin=dict(l=0, r=0, t=85, b=0))

    fig.write_html(salida, include_plotlyjs="cdn")
    print(f"[OK] {salida} · {Z.shape[0]} fechas x {Z.shape[1]} plazos")
    return fig


# ===========================================================================
# 6) EJECUCIÓN
# ===========================================================================

if __name__ == "__main__":
    df = cargar()
    panel = construir_panel(df)
    Z = construir_superficie(panel)
    fig = graficar(Z)
    fig.show()
