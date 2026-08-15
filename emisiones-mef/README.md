# Emisiones internas de bonos soberanos del Perú (2001–2026)

¿Cómo ha evolucionado la estrategia de emisión del MEF? Entre 2001 y 2026 se
colocaron **S/ 281,749 MM** en subastas internas: el tramo corto (0–5 años)
desapareció después de 2006 y el **62.5% del total se concentró en 5–15 años**,
con picos de emisión larga en 2017 (bonos 2055) y 2019 (reaperturas 2034/2040).

**[Ver el gráfico interactivo](https://diegocorazao.github.io/emisiones-mef/)**
— emisión anual apilada por tramo de plazo + cuadro de totales por año.

## Pipeline

1. `emisiones_mef_a_excel.py` — parsea el PDF público del MEF (46 páginas,
   1,490 subastas) con **tres motores de extracción complementarios** y valida
   cada año contra la fila "Total" impresa en el propio documento: 22 de 26
   años cuadran exactos; los 4 restantes quedan marcados en la hoja Validación.
2. `emisiones_interactivo.py` — agrega por año y tramo de plazo (0–5, 5–15,
   15–30, 30+ años) y genera el HTML con Plotly.

Datos: PDF público del MEF (sin restricciones de redistribución).

```
pip install pdfplumber pandas plotly openpyxl
python emisiones_mef_a_excel.py Emisiones_bonos_soberanos.pdf
python emisiones_interactivo.py
```
