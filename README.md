# Guatemala Medical Camp — Synthetic Patient Roster

Generator for a **simulated** 215-patient dataset modeling what a small medical
camp in Guatemala (seeing ~180 people) would realistically encounter, plus 35
records marked `*` as provided by **Hospital San Juan de Dios, Guatemala City**.

> ⚠️ **All data is synthetic.** No row represents a real person. Values are drawn
> from random distributions calibrated to published population-prevalence figures
> for Guatemala, then made internally consistent (weight follows BMI × height²,
> blood pressure rises with age and BMI, presbyopia rises with age, etc.).

## Contents

- `generate_camp_data.py` — deterministic generator (fixed seed) that builds the workbook.
- `Guatemala_Medical_Camp_Roster.xlsx` — output workbook with three sheets:
  - **Patient Data** — one row per patient (age, sex, origin, height/weight/BMI,
    blood pressure with color-coded category, HR, temp, SpO₂, random glucose,
    visual acuity / needs-glasses, primary diagnosis, secondary findings, source).
  - **Summary** — live `COUNTIF` tallies (hypertension, diabetes, overweight/obese,
    needs glasses, chronic malnutrition, healthy, …) with the prevalence basis for each.
  - **Read Me** — disclaimer and the epidemiology sources used to calibrate.

## Regenerate

```bash
pip install openpyxl
python3 generate_camp_data.py
```

## Prevalence sources used for calibration

- Hypertension & diabetes: rural Indigenous Guatemala survey (PMC9695220); PAHO country indicators.
- Overweight/obesity, malnutrition/stunting, anemia: Global Nutrition Report — Guatemala profile.
- Refractive error / presbyopia: RAAB Bogotá, Colombia (Optom Vis Sci 2019, PMID 31318796) as a regional proxy.
