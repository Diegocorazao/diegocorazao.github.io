#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
emisiones_interactivo.py
========================
Emisiones internas de bonos soberanos del Perú (MEF, 2001-2026).

Genera un HTML interactivo con dos gráficos:
  1. Emisión por año   -> barras apiladas por tramo de plazo
  2. Emisión por plazo -> barras horizontales por tramo

y exporta las dos tablas agregadas a un Excel (Resumen_emisiones.xlsx).

Tramos de plazo (años desde emisión hasta vencimiento):
  0-5 | 5-15 | 15-30 | 30+

Uso:
    pip install pandas plotly openpyxl
    python emisiones_interactivo.py [Emisiones_bonos_soberanos_MEF.xlsx]

Fuente de datos: PDF público del MEF procesado con emisiones_mef_a_excel.py
"""
import sys

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

ARCHIVO = sys.argv[1] if len(sys.argv) > 1 else \
    'Emisiones_bonos_soberanos_MEF.xlsx'
SALIDA_HTML = 'emisiones_interactivo.html'
SALIDA_XLSX = 'Resumen_emisiones.xlsx'

# ----------------------------------------------------------------- datos ----
df = pd.read_excel(ARCHIVO, sheet_name='Emisiones')
df = df[df['Monto Colocado (S/)'].notna()].copy()

if 'Duracion' in df.columns:
    df['Plazo'] = pd.to_numeric(df['Duracion'], errors='coerce')
else:
    df['Plazo'] = (pd.to_datetime(df['Fecha Vencimiento'])
                   - pd.to_datetime(df['Fecha Emisión'])).dt.days / 365.25
df = df[df['Plazo'].notna() & (df['Plazo'] > 0)]

TRAMOS = [(0, 5, '0-5 años', '#6fa8dc'),
          (5, 15, '5-15 años', '#1f4e78'),
          (15, 30, '15-30 años', '#f2a33c'),
          (30, 99, '30+ años', '#c0392b')]

def tramo(p):
    for lo, hi, nombre, _ in TRAMOS:
        if lo < p <= hi:
            return nombre
    return TRAMOS[-1][2]

df['Tramo'] = df['Plazo'].map(tramo)
df['MM'] = df['Monto Colocado (S/)'] / 1e6
COLOR = {n: c for _, _, n, c in TRAMOS}
ORDEN = [n for _, _, n, _ in TRAMOS]

# --------------------------------------------------------------- tablas -----
tab_anual = (df.groupby(['Año', 'Tramo'])['MM'].sum()
               .unstack(fill_value=0).reindex(columns=ORDEN, fill_value=0))
tab_anual['Total'] = tab_anual.sum(axis=1)

tab_plazo = df.groupby('Tramo')['MM'].sum().reindex(ORDEN).to_frame('S/ MM')
tab_plazo['%'] = tab_plazo['S/ MM'] / tab_plazo['S/ MM'].sum() * 100

with pd.ExcelWriter(SALIDA_XLSX, engine='openpyxl') as xw:
    tab_anual.round(0).to_excel(xw, sheet_name='Por año')
    tab_plazo.round(1).to_excel(xw, sheet_name='Por plazo')

# -------------------------------------------------------------- gráficos ----
fig = make_subplots(
    rows=2, cols=2, row_heights=[0.60, 0.40], vertical_spacing=0.13,
    specs=[[{'type': 'xy', 'colspan': 2}, None],
           [{'type': 'table'}, {'type': 'table'}]],
    subplot_titles=('<b>Emisión por año</b> (monto colocado, S/ millones)',
                    '<b>Total emitido por año</b> (S/ MM)', ''))

# 1) barras apiladas por año
for nombre in ORDEN:
    fig.add_trace(go.Bar(
        x=tab_anual.index, y=tab_anual[nombre], name=nombre,
        marker_color=COLOR[nombre], legendgroup=nombre,
        hovertemplate=('<b>%{x}</b> · ' + nombre +
                       '<br>S/ %{y:,.0f} MM<extra></extra>')),
        row=1, col=1)

# 2) cuadro con el total por año (dos mitades, lado a lado)
tot = tab_anual['Total'].round(0).astype(int)
mitad = (len(tot) + 1) // 2
def tabla(serie, col):
    fig.add_trace(go.Table(
        header=dict(values=['<b>Año</b>', '<b>Total colocado (S/ MM)</b>'],
                    fill_color='#1f4e78', align=['center', 'right'],
                    font=dict(color='white', family='Arial', size=13),
                    height=26),
        cells=dict(values=[serie.index,
                           [f'{v:,.0f}' for v in serie.values]],
                   align=['center', 'right'],
                   fill_color=[['#f2f6fb', 'white'] * len(serie)],
                   font=dict(family='Arial', size=13), height=24)),
        row=2, col=col)
tabla(tot.iloc[:mitad], 1)
tabla(tot.iloc[mitad:], 2)

fig.update_layout(
    template='plotly_white', barmode='stack',
    title=dict(text='<b>Emisiones internas de bonos soberanos del Perú</b>'
                    '<br><sup>Fuente: MEF (2001-2026) · montos colocados en '
                    'subastas OE/OAD/BDA</sup>', x=0.01),
    font=dict(family='Arial', size=13),
    legend=dict(title='Plazo de emisión', orientation='h',
                y=1.07, x=0.99, xanchor='right'),
    margin=dict(t=115, r=40, b=30, l=70),
    height=920,
    hoverlabel=dict(font_size=12))
fig.update_xaxes(dtick=2, row=1, col=1)
fig.update_yaxes(tickformat=',', row=1, col=1)

fig.write_html(SALIDA_HTML, include_plotlyjs='cdn',
               config=dict(displaylogo=False))

print(f'Listo: {SALIDA_HTML} y {SALIDA_XLSX}\n')
print('=== Emisión por año (S/ MM) ===')
print(tab_anual.round(0).astype(int).to_string())
print('\n=== Emisión por plazo (S/ MM) ===')
print(tab_plazo.round(1).to_string())
