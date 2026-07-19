#!/usr/bin/env python3
"""
Generate a synthetic medical-camp patient roster for Guatemala.

215 patients total:
  - Patients 1-180 : seen at the mobile medical camp (~180 people)
  - Patients 181-215 : 35 records provided by Hospital San Juan de Dios, Guatemala City (marked *)

All rows are SIMULATED. Individual patients are not real; values are drawn from
distributions calibrated to published prevalence data for Guatemala (see SOURCES
in the workbook's "Read Me" sheet). Deterministic via fixed random seed.
"""

import random
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SEED = 20260719
random.seed(SEED)

N_TOTAL = 215
N_CAMP = 180  # rows 1..180 ; rows 181..215 are hospital-provided

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def pick(weighted):
    """weighted = list of (value, weight)."""
    vals, wts = zip(*weighted)
    return random.choices(vals, weights=wts, k=1)[0]

def clamp(x, lo, hi):
    return max(lo, min(hi, x))

# Guatemalan departments / common origins for a Guatemala City-area camp
ORIGINS = [
    ("Guatemala (Ciudad)", 26), ("Mixco", 10), ("Villa Nueva", 10),
    ("Chimaltenango", 8), ("Sacatepéquez", 6), ("Chinautla", 5),
    ("Amatitlán", 5), ("Escuintla", 5), ("San Juan Sacatepéquez", 5),
    ("Sololá", 4), ("Quiché", 4), ("Petén", 3), ("Jalapa", 3),
    ("Santa Rosa", 3), ("Totonicapán", 3),
]

# ---------------------------------------------------------------------------
# Per-patient generation
# ---------------------------------------------------------------------------

def gen_age(is_hospital):
    """Camp-attendance age skew: many children, more adult women & elderly.
    Hospital-provided records skew a bit older / sicker."""
    if is_hospital:
        band = pick([("0-12", 8), ("13-17", 4), ("18-39", 20),
                     ("40-59", 34), ("60-79", 30), ("80-95", 4)])
    else:
        band = pick([("0-12", 18), ("13-17", 6), ("18-39", 24),
                     ("40-59", 28), ("60-79", 20), ("80-95", 4)])
    lo, hi = map(int, band.split("-"))
    return random.randint(lo, hi)

def gen_sex(age):
    # Camps draw more women; but pediatric ~50/50
    if age < 13:
        return pick([("F", 50), ("M", 50)])
    return pick([("F", 62), ("M", 38)])

def gen_height_cm(age, sex):
    """Short stature is common (high chronic-malnutrition/stunting history).
    Adult female mean ~150 cm, male ~162 cm."""
    if age < 1:
        return round(random.gauss(72, 4), 1)
    if age < 13:
        # rough pediatric height by age (stunting-shifted)
        base = 76 + (age - 1) * 5.8
        return round(clamp(random.gauss(base, 4.5), 68, 158), 1)
    if age < 18:
        base = 150 if sex == "F" else 158
        return round(clamp(random.gauss(base, 7), 135, 178), 1)
    mean = 150.5 if sex == "F" else 162.0
    return round(clamp(random.gauss(mean, 6.2), 137, 185), 1)

def gen_bmi(age, sex, is_hospital):
    """Adults: high overweight/obesity (women esp.). Children lower/leaner,
    some underweight reflecting chronic malnutrition."""
    if age < 13:
        # children: center near normal, left tail = wasting/underweight
        return round(clamp(random.gauss(15.8, 2.2), 12.0, 24.0), 1)
    if age < 18:
        return round(clamp(random.gauss(21.5, 3.3), 15.0, 33.0), 1)
    # adults
    if sex == "F":
        mean, sd = 27.4, 4.8
    else:
        mean, sd = 25.9, 4.2
    if is_hospital:
        mean += 0.8
    return round(clamp(random.gauss(mean, sd), 16.5, 44.0), 1)

def bmi_category(age, bmi):
    if age < 18:
        # simplified pediatric flags
        if bmi < 14.0:
            return "Underweight"
        if bmi < 22:
            return "Normal"
        if bmi < 26:
            return "Overweight"
        return "Obese"
    if bmi < 18.5:
        return "Underweight"
    if bmi < 25:
        return "Normal"
    if bmi < 30:
        return "Overweight"
    return "Obese"

def gen_bp(age, bmi, is_hospital):
    """Systolic/diastolic correlated with age and BMI. Adult hypertension ~28-32%."""
    if age < 13:
        sys = random.gauss(98 + age * 1.4, 7)
        dia = random.gauss(62 + age * 0.5, 6)
        return int(clamp(sys, 80, 122)), int(clamp(dia, 48, 82))
    base_s = 104 + max(0, age - 18) * 0.46 + max(0, bmi - 25) * 0.72
    base_d = 66 + max(0, age - 18) * 0.15 + max(0, bmi - 25) * 0.42
    if is_hospital:
        base_s += 5
        base_d += 3
    sys = int(clamp(random.gauss(base_s, 12), 90, 210))
    dia = int(clamp(random.gauss(base_d, 8), 55, 125))
    if dia >= sys - 25:
        dia = sys - random.randint(30, 45)
    return sys, dia

def bp_category(sys, dia, age):
    if age < 13:
        return "Normal (pediatric)"
    if sys >= 180 or dia >= 120:
        return "Hypertensive crisis"
    if sys >= 140 or dia >= 90:
        return "Stage 2 HTN"
    if sys >= 130 or dia >= 80:
        return "Stage 1 HTN"
    if sys >= 120:
        return "Elevated"
    return "Normal"

def gen_hr(age):
    if age < 2:
        return int(clamp(random.gauss(120, 12), 90, 150))
    if age < 13:
        return int(clamp(random.gauss(92, 10), 70, 120))
    return int(clamp(random.gauss(76, 10), 52, 110))

def gen_temp():
    # occasional febrile presentation
    if random.random() < 0.06:
        return round(random.uniform(37.6, 39.2), 1)
    return round(random.gauss(36.7, 0.25), 1)

def gen_spo2():
    # Guatemala City ~1500 m altitude -> slightly lower normals
    if random.random() < 0.04:
        return random.randint(88, 93)
    return random.randint(94, 99)

def gen_glucose(age, bmi, is_hospital):
    """Random capillary glucose (mg/dL). Diabetes ~10-13% adults, prediabetes band too."""
    if age < 18:
        return int(clamp(random.gauss(92, 12), 65, 140))
    p_dm = 0.10 + max(0, bmi - 27) * 0.012 + max(0, age - 45) * 0.003
    if is_hospital:
        p_dm += 0.10
    r = random.random()
    if r < p_dm:
        return int(clamp(random.gauss(215, 55), 145, 430))     # diabetic range
    if r < p_dm + 0.16:
        return int(clamp(random.gauss(160, 12), 141, 199))     # impaired / prediabetes
    return int(clamp(random.gauss(98, 14), 65, 139))           # normal

def gen_vision(age):
    """Needs-glasses reflects presbyopia (very high 40+) + uncorrected refractive error."""
    if age < 6:
        return "20/20", "No"
    if age < 40:
        if random.random() < 0.14:
            acu = random.choice(["20/40", "20/50", "20/60"])
            return acu, "Yes (distance)"
        return "20/20", "No"
    # 40+ : presbyopia dominates
    p = 0.55 + (age - 40) * 0.01
    if random.random() < clamp(p, 0.5, 0.9):
        if random.random() < 0.35:
            return random.choice(["20/40", "20/50"]), "Yes (distance + reading)"
        return "20/25", "Yes (reading)"
    return "20/20", "No"

# Secondary findings pool (common at Guatemalan camps)
def gen_secondary(age, sex, bmi, glucose):
    findings = []
    def maybe(name, p):
        if random.random() < p:
            findings.append(name)
    if age < 13:
        maybe("Intestinal parasitosis", 0.24)
        maybe("Dental caries", 0.35)
        maybe("Acute respiratory infection", 0.14)
        maybe("Anemia (suspected)", 0.18)
        maybe("Chronic malnutrition / short stature", 0.26)
        maybe("Skin infection / scabies", 0.07)
    else:
        maybe("Dental caries", 0.30)
        maybe("Intestinal parasitosis", 0.10)
        maybe("Gastritis / dyspepsia", 0.12)
        maybe("Low back / joint pain (osteoarthritis)", 0.14 + max(0, age - 45) * 0.005)
        maybe("Dermatitis / fungal skin infection", 0.10)
        maybe("Headache / migraine", 0.09)
        maybe("Vaginal/urinary infection", 0.10 if sex == "F" else 0.0)
        if sex == "F" and 15 <= age <= 45 and random.random() < 0.06:
            findings.append("Pregnancy (prenatal check)")
        maybe("Anemia (suspected)", 0.14 if sex == "F" else 0.06)
        maybe("Allergic rhinitis", 0.07)
        maybe("Cataract (referral)", 0.10 if age >= 60 else 0.0)
    return "; ".join(findings)

def primary_dx(age, bmi_cat, bp_cat, glucose, needs_glasses, secondary):
    """Choose the single most clinically salient primary diagnosis."""
    if bp_cat in ("Stage 2 HTN", "Hypertensive crisis"):
        return "Hypertension"
    if glucose >= 200:
        return "Diabetes mellitus (type 2)"
    if bp_cat == "Stage 1 HTN":
        return "Hypertension (stage 1)"
    if 141 <= glucose <= 199 and age >= 18:
        return "Hyperglycemia / prediabetes"
    if bmi_cat == "Obese" and age >= 18:
        return "Obesity"
    if "Chronic malnutrition / short stature" in secondary or bmi_cat == "Underweight" and age < 13:
        return "Chronic malnutrition"
    if secondary:
        return secondary.split(";")[0].strip()
    if needs_glasses.startswith("Yes"):
        return "Refractive error (needs glasses)"
    return "Healthy — no acute findings"

# ---------------------------------------------------------------------------
# Build rows
# ---------------------------------------------------------------------------

rows = []
for pid in range(1, N_TOTAL + 1):
    is_hospital = pid > N_CAMP
    age = gen_age(is_hospital)
    sex = gen_sex(age)
    origin = pick(ORIGINS)
    height = gen_height_cm(age, sex)
    bmi = gen_bmi(age, sex, is_hospital)
    weight = round(bmi * (height / 100) ** 2, 1)
    bcat = bmi_category(age, bmi)
    sys, dia = gen_bp(age, bmi, is_hospital)
    bpcat = bp_category(sys, dia, age)
    hr = gen_hr(age)
    temp = gen_temp()
    spo2 = gen_spo2()
    glucose = gen_glucose(age, bmi, is_hospital)
    acuity, needs_glasses = gen_vision(age)
    secondary = gen_secondary(age, sex, bmi, glucose)
    pdx = primary_dx(age, bcat, bpcat, glucose, needs_glasses, secondary)

    label = f"{pid} *" if is_hospital else str(pid)
    rows.append({
        "id": label,
        "num": pid,
        "age": age,
        "sex": sex,
        "origin": origin,
        "height": height,
        "weight": weight,
        "bmi": bmi,
        "bcat": bcat,
        "sys": sys,
        "dia": dia,
        "bp": f"{sys}/{dia}",
        "bpcat": bpcat,
        "hr": hr,
        "temp": temp,
        "spo2": spo2,
        "glucose": glucose,
        "acuity": acuity,
        "glasses": needs_glasses,
        "pdx": pdx,
        "secondary": secondary,
        "source": "Hospital San Juan de Dios *" if is_hospital else "Camp",
    })

# ---------------------------------------------------------------------------
# Write workbook
# ---------------------------------------------------------------------------

wb = Workbook()

FONT = "Arial"
HEADER_FILL = PatternFill("solid", fgColor="1F4E5F")
HEADER_FONT = Font(name=FONT, bold=True, color="FFFFFF", size=10)
TITLE_FONT = Font(name=FONT, bold=True, size=14, color="1F4E5F")
NOTE_FONT = Font(name=FONT, italic=True, size=9, color="7A0000")
BASE_FONT = Font(name=FONT, size=10)
HOSP_FILL = PatternFill("solid", fgColor="FDEDEC")
thin = Side(style="thin", color="D0D0D0")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
CENTER = Alignment(horizontal="center", vertical="center")
LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)

BP_FILLS = {
    "Stage 2 HTN": PatternFill("solid", fgColor="F5B7B1"),
    "Hypertensive crisis": PatternFill("solid", fgColor="E74C3C"),
    "Stage 1 HTN": PatternFill("solid", fgColor="FAD7A0"),
    "Elevated": PatternFill("solid", fgColor="FCF3CF"),
}

# ---- Sheet 1: Patient Data -------------------------------------------------
ws = wb.active
ws.title = "Patient Data"

columns = [
    ("Patient #", "id", 10),
    ("Age", "age", 6),
    ("Sex", "sex", 6),
    ("Origin (municipio/depto)", "origin", 22),
    ("Height (cm)", "height", 10),
    ("Weight (kg)", "weight", 10),
    ("BMI", "bmi", 7),
    ("BMI category", "bcat", 13),
    ("BP (mmHg)", "bp", 10),
    ("BP category", "bpcat", 17),
    ("Resting HR (bpm)", "hr", 9),
    ("Temp (°C)", "temp", 8),
    ("SpO₂ (%)", "spo2", 8),
    ("Random glucose (mg/dL)", "glucose", 11),
    ("Visual acuity", "acuity", 10),
    ("Needs glasses", "glasses", 15),
    ("Primary diagnosis", "pdx", 26),
    ("Secondary findings", "secondary", 42),
    ("Data source", "source", 24),
]

# Title + disclaimer
ws.merge_cells("A1:S1")
ws["A1"] = "Medical Camp — Patient Roster (Guatemala)"
ws["A1"].font = TITLE_FONT
ws["A1"].alignment = Alignment(horizontal="left", vertical="center")
ws.row_dimensions[1].height = 22

ws.merge_cells("A2:S2")
ws["A2"] = ("SIMULATED / SYNTHETIC DATA — generated for a mock template, not real patients. "
            "Values are drawn from distributions calibrated to published Guatemala prevalence data "
            "(see 'Read Me' sheet). Patients 1–180: mobile camp.  Patients 181–215 (marked *): "
            "35 records provided by Hospital San Juan de Dios, Guatemala City.")
ws["A2"].font = NOTE_FONT
ws["A2"].alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
ws.row_dimensions[2].height = 42

HEADER_ROW = 4
for c, (title, key, width) in enumerate(columns, start=1):
    cell = ws.cell(row=HEADER_ROW, column=c, value=title)
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = CENTER
    cell.border = BORDER
    ws.column_dimensions[get_column_letter(c)].width = width

r = HEADER_ROW + 1
for row in rows:
    for c, (title, key, width) in enumerate(columns, start=1):
        cell = ws.cell(row=r, column=c, value=row[key])
        cell.font = BASE_FONT
        cell.border = BORDER
        if key in ("secondary", "origin", "pdx", "source"):
            cell.alignment = LEFT
        else:
            cell.alignment = CENTER
    # highlight BP category cell
    bpcell = ws.cell(row=r, column=10)
    if row["bpcat"] in BP_FILLS:
        bpcell.fill = BP_FILLS[row["bpcat"]]
    # tint hospital-provided rows faintly
    if row["source"].startswith("Hospital"):
        ws.cell(row=r, column=1).fill = HOSP_FILL
    r += 1

# footnote after the data
foot = r + 1
ws.merge_cells(start_row=foot, start_column=1, end_row=foot, end_column=19)
fcell = ws.cell(row=foot, column=1,
    value=("*  Patients 181–215 (35 records) were not seen at the camp; their data was provided by "
           "Hospital San Juan de Dios, Guatemala City. These records skew slightly older and toward "
           "established chronic disease."))
fcell.font = NOTE_FONT
fcell.alignment = LEFT
ws.row_dimensions[foot].height = 30

ws.freeze_panes = "A5"
ws.sheet_view.showGridLines = False

# ---- Sheet 2: Summary ------------------------------------------------------
sm = wb.create_sheet("Summary")
sm.sheet_view.showGridLines = False
sm.merge_cells("A1:D1")
sm["A1"] = "Summary Statistics — 215 patients"
sm["A1"].font = TITLE_FONT
sm.column_dimensions["A"].width = 42
sm.column_dimensions["B"].width = 12
sm.column_dimensions["C"].width = 12
sm.column_dimensions["D"].width = 46

# The data lives in Patient Data rows 5 .. 5+N-1
first = HEADER_ROW + 1
last = HEADER_ROW + N_TOTAL
PD = "'Patient Data'!"

def col_range(col_letter):
    return f"{PD}{col_letter}{first}:{col_letter}{last}"

# column letters in Patient Data
C_AGE, C_SEX, C_BMICAT, C_BPCAT, C_GLU, C_GLASSES, C_PDX = "B", "C", "H", "J", "N", "P", "Q"

hdr = ["Metric", "Count", "% of 215", "Notes / basis"]
hrow = 3
for c, h in enumerate(hdr, start=1):
    cell = sm.cell(row=hrow, column=c, value=h)
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = CENTER
    cell.border = BORDER

# Each metric: (label, COUNTIF-style formula fragment for Count, note)
metrics = [
    ("Total patients seen",
     f"COUNTA({col_range('A')})",
     "180 camp + 35 hospital (*)"),
    ("Female",
     f'COUNTIF({col_range(C_SEX)},"F")', "Camps skew female"),
    ("Male",
     f'COUNTIF({col_range(C_SEX)},"M")', ""),
    ("Children (<13 yrs)",
     f'COUNTIF({col_range(C_AGE)},"<13")', ""),
    ("Adults 18+",
     f'COUNTIF({col_range(C_AGE)},">=18")', ""),
    ("Older adults 60+",
     f'COUNTIF({col_range(C_AGE)},">=60")', ""),
    ("Hypertension (any stage 1/2/crisis)",
     f'COUNTIF({col_range(C_BPCAT)},"Stage 1 HTN")+COUNTIF({col_range(C_BPCAT)},"Stage 2 HTN")+COUNTIF({col_range(C_BPCAT)},"Hypertensive crisis")',
     "Nat'l modeled ~32% adults; PAHO ~20-22%"),
    ("  of which Stage 2 / crisis",
     f'COUNTIF({col_range(C_BPCAT)},"Stage 2 HTN")+COUNTIF({col_range(C_BPCAT)},"Hypertensive crisis")',
     "Referral / same-day treatment"),
    ("Elevated BP (pre-HTN)",
     f'COUNTIF({col_range(C_BPCAT)},"Elevated")', ""),
    ("Diabetes (random glucose ≥200)",
     f'COUNTIF({col_range(C_GLU)},">=200")',
     "Nat'l modeled ~10-20%; indigenous ~12.5%"),
    ("Hyperglycemia / prediabetes (141-199)",
     f'COUNTIFS({col_range(C_GLU)},">=141",{col_range(C_GLU)},"<200")', ""),
    ("Overweight (BMI 25-<30)",
     f'COUNTIF({col_range(C_BMICAT)},"Overweight")', ""),
    ("Obese",
     f'COUNTIF({col_range(C_BMICAT)},"Obese")',
     "Adult obesity ~21% (F 29.6%, M 17.6%)"),
    ("Underweight",
     f'COUNTIF({col_range(C_BMICAT)},"Underweight")', "Mostly children"),
    ("Needs glasses (any)",
     f'COUNTA({col_range(C_GLASSES)})-COUNTIF({col_range(C_GLASSES)},"No")',
     "Presbyopia 40+ ~55%; uncorr. refr. error ~12%"),
    ("Chronic malnutrition (primary dx)",
     f'COUNTIF({col_range(C_PDX)},"Chronic malnutrition")',
     "Stunting <5 ~47% nationally"),
    ("Healthy — no acute findings",
     f'COUNTIF({col_range(C_PDX)},"Healthy — no acute findings")',
     "No primary/secondary finding recorded"),
]

r = hrow + 1
for label, count_formula, note in metrics:
    sm.cell(row=r, column=1, value=label).font = BASE_FONT
    ccell = sm.cell(row=r, column=2, value=f"={count_formula}")
    ccell.font = BASE_FONT
    ccell.alignment = CENTER
    pcell = sm.cell(row=r, column=3, value=f"=B{r}/215")
    pcell.number_format = "0.0%"
    pcell.font = BASE_FONT
    pcell.alignment = CENTER
    ncell = sm.cell(row=r, column=4, value=note)
    ncell.font = Font(name=FONT, size=9, color="555555")
    ncell.alignment = LEFT
    for c in range(1, 5):
        sm.cell(row=r, column=c).border = BORDER
    r += 1

sm.merge_cells(start_row=r + 1, start_column=1, end_row=r + 1, end_column=4)
disc = sm.cell(row=r + 1, column=1,
    value=("Counts are computed live from the Patient Data sheet. Percentages are of all 215 patients "
           "(camp + hospital) unless a note specifies an adult/child subset. Simulated data — see Read Me."))
disc.font = NOTE_FONT
disc.alignment = LEFT
sm.row_dimensions[r + 1].height = 28

# ---- Sheet 3: Read Me / sources -------------------------------------------
rm = wb.create_sheet("Read Me")
rm.sheet_view.showGridLines = False
rm.column_dimensions["A"].width = 110
lines = [
    ("Medical Camp Patient Roster — Guatemala (SIMULATED DATA)", TITLE_FONT),
    ("", BASE_FONT),
    ("What this is:", Font(name=FONT, bold=True, size=11)),
    ("A realistic mock/template dataset of 215 patients for a small medical camp in Guatemala.", BASE_FONT),
    ("Patients 1–180 represent people seen at the mobile camp. Patients 181–215 (marked with *)", BASE_FONT),
    ("are 35 records provided by Hospital San Juan de Dios, Guatemala City.", BASE_FONT),
    ("", BASE_FONT),
    ("IMPORTANT — these are NOT real patients.", Font(name=FONT, bold=True, size=11, color="7A0000")),
    ("Every row is synthetically generated. Individual values were drawn at random from distributions", BASE_FONT),
    ("calibrated to published population prevalence figures (below), then made internally consistent", BASE_FONT),
    ("(weight follows BMI×height²; blood pressure rises with age and BMI; presbyopia rises with age; etc.).", BASE_FONT),
    ("Do not treat any single row as a real clinical measurement. Generation seed: %d (reproducible)." % SEED, BASE_FONT),
    ("", BASE_FONT),
    ("Prevalence sources used to calibrate the distributions:", Font(name=FONT, bold=True, size=11)),
    ("• Hypertension: national modeled ~32% of adults; PAHO ~20–22%; rural Indigenous survey 20.3%.", BASE_FONT),
    ("    PMC9695220 (BMJ Open Diab Res Care, 2022); PAHO country indicators.", BASE_FONT),
    ("• Diabetes: national modeled ~10–20%; rural Indigenous survey 12.5%; PAHO ~9–10%.", BASE_FONT),
    ("    PMC9695220; PAHO country indicators.", BASE_FONT),
    ("• Overweight/obesity: adult obesity ~21% (women 29.6%, men 17.6%); overweight+obesity majority of adults.", BASE_FONT),
    ("    Global Nutrition Report — Guatemala profile; Statista 2010–2022 series.", BASE_FONT),
    ("• Chronic malnutrition / stunting: ~46.7% of children <5 (among highest globally).", BASE_FONT),
    ("    Global Nutrition Report — Guatemala profile; FANTA/PROFILES.", BASE_FONT),
    ("• Anemia: women 15–49 ~7–15%; children <5 ~32%.  Global Nutrition Report — Guatemala.", BASE_FONT),
    ("• Uncorrected refractive error ~12.5%; presbyopia in adults 35+ ~55% (RAAB Bogotá, Colombia proxy).", BASE_FONT),
    ("    Casas Luque et al., Optom Vis Sci 2019 (PMID 31318796).", BASE_FONT),
    ("", BASE_FONT),
    ("How to use:", Font(name=FONT, bold=True, size=11)),
    ("• 'Patient Data' — one row per patient; BP-category cells are color-coded (yellow→red by severity).", BASE_FONT),
    ("• 'Summary' — live COUNTIF tallies with the % of the 215 and the prevalence basis for each metric.", BASE_FONT),
    ("• Replace simulated rows with real intake data as it is collected; the Summary updates automatically.", BASE_FONT),
]
for i, (text, font) in enumerate(lines, start=1):
    cell = rm.cell(row=i, column=1, value=text)
    cell.font = font
    cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=False)

# Force Excel / Google Sheets to recompute all formulas on open, so the
# Summary tallies display correctly even without a prior LibreOffice recalc.
wb.calculation.fullCalcOnLoad = True

OUT = "Guatemala_Medical_Camp_Roster.xlsx"
wb.save(OUT)
print("Wrote", OUT, "with", len(rows), "patients")
