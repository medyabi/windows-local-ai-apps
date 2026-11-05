"""Generates a synthetic datasheet library for demoing Offline Spec Sheet Q&A.
Fictional manufacturer "Halcyon Micro" — every part, number and document is invented."""
import os, csv
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sample-datasheets")
os.makedirs(OUT, exist_ok=True)

ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=20, textColor=colors.HexColor("#1b2a41"), alignment=0, spaceAfter=2)
SUB = ParagraphStyle("SUB", parent=ss["Normal"], fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#5a6478"), spaceAfter=8)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=12, textColor=colors.HexColor("#c0392b"), spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("BODY", parent=ss["Normal"], fontName="Helvetica", fontSize=9, leading=12)
BUL = ParagraphStyle("BUL", parent=BODY, leftIndent=10, bulletIndent=0)
CELL = ParagraphStyle("CELL", parent=BODY, fontSize=8, leading=10)


def table(rows, widths, header=True):
    data = [[Paragraph(str(c), CELL) for c in r] for r in rows]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if header else 0)
    st = [("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c9c3b4")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]
    if header:
        st += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1b2a41")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
        data[0] = [Paragraph(f"<font color='white'><b>{c}</b></font>", CELL) for c in rows[0]]
        t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle(st))
    return t


def footer(part, rev):
    def _f(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#5a6478"))
        canvas.drawString(18 * mm, 10 * mm, f"Halcyon Micro  |  {part}  |  {rev}  |  Synthetic demo document — fictional part")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()
    return _f


def build_datasheet(p):
    path = os.path.join(OUT, p["file"])
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
                            title=f"{p['part']} datasheet", author="Halcyon Micro (fictional)")
    s = [Paragraph(p["part"], H1), Paragraph(p["title"], SUB), Paragraph("Features", H2)]
    for f in p["features"]:
        s.append(Paragraph(f, BUL, bulletText="•"))
    s += [Paragraph("General description", H2), Paragraph(p["desc"], BODY), Paragraph("Applications", H2),
          Paragraph(", ".join(p["apps"]) + ".", BODY), Paragraph("Ordering information", H2),
          table([["Order code", "Package", "Packing", "Temperature grade"]] + p["order"], [40, 45, 40, 45]), PageBreak()]
    s += [Paragraph("Absolute maximum ratings", H2),
          Paragraph("Stresses beyond these ratings may cause permanent damage. Functional operation is not implied.", BODY),
          table([["Parameter", "Min", "Max", "Unit"]] + p["abs"], [80, 25, 25, 25]),
          Paragraph("Recommended operating conditions", H2),
          table([["Parameter", "Min", "Typ", "Max", "Unit"]] + p["rec"], [70, 22, 22, 22, 22]),
          Paragraph("Electrical characteristics", H2),
          Paragraph(p.get("elec_note", "Typical values at TA = 25 °C unless otherwise noted."), BODY),
          table([["Parameter", "Conditions", "Min", "Typ", "Max", "Unit"]] + p["elec"], [38, 52, 16, 16, 16, 16]), PageBreak()]
    s += [Paragraph("Pin configuration and functions", H2),
          table([["Pin", "Name", "Type", "Description"]] + p["pins"], [14, 28, 24, 94])]
    s += [Paragraph("Package and thermal information", H2),
          table([["Package", "Thermal resistance θJA", "Dimensions"]] + p["thermal"], [45, 60, 55])]
    s += [Paragraph("Application information", H2)]
    for t in p["notes"]:
        s.append(Paragraph(t, BODY)); s.append(Spacer(1, 3))
    s += [Paragraph("Revision history", H2), table([["Revision", "Date", "Change"]] + p["rev"], [25, 30, 105])]
    doc.build(s, onFirstPage=footer(p["part"], p["rev"][-1][0]), onLaterPages=footer(p["part"], p["rev"][-1][0]))
    print("wrote", p["file"])


PARTS = [
 dict(file="HM3300_LDO_Regulator.pdf", part="HM3300", title="500 mA, 3.3 V fixed low-dropout (LDO) linear regulator",
  features=["Input voltage range: 2.5 V to 6.0 V", "Fixed 3.3 V output, ±1% accuracy at 25 °C", "Output current up to 500 mA",
            "Dropout voltage: 180 mV typical at 500 mA", "Quiescent current: 45 µA typical", "PSRR: 70 dB at 1 kHz",
            "Thermal shutdown at 160 °C with 20 °C hysteresis", "Active-high enable input", "Available in SOT-23-5 and DFN-6 packages"],
  desc="The HM3300 is a low-noise, low-quiescent-current LDO regulator intended for battery-powered and noise-sensitive designs. It is stable with a 1 µF ceramic output capacitor and includes current limit, thermal shutdown and a shutdown mode that reduces supply current to 0.1 µA typical.",
  apps=["Wearables", "Sensor nodes", "BLE modules", "Portable instruments"],
  order=[["HM3300-SOT5-T", "SOT-23-5", "Tape & reel, 3000", "−40 °C to 125 °C"], ["HM3300-DFN6-T", "DFN-6 (2×2 mm)", "Tape & reel, 5000", "−40 °C to 125 °C"]],
  abs=[["VIN to GND", "−0.3", "7.0", "V"], ["EN to GND", "−0.3", "VIN + 0.3", "V"], ["Output short-circuit duration", "—", "Continuous", ""], ["ESD, human body model", "—", "2", "kV"],
       ["Junction temperature TJ", "—", "150", "°C"], ["Storage temperature", "−65", "150", "°C"]],
  rec=[["Input voltage VIN", "2.5", "—", "6.0", "V"], ["Output current IOUT", "0", "—", "500", "mA"], ["Ambient temperature TA", "−40", "—", "125", "°C"],
       ["Input capacitor CIN", "1", "—", "—", "µF"], ["Output capacitor COUT (ceramic)", "1", "—", "—", "µF"]],
  elec=[["Output voltage", "IOUT = 1 mA, VIN = 4.3 V", "3.267", "3.300", "3.333", "V"], ["Line regulation", "VIN = 3.8 V to 6.0 V", "—", "0.02", "0.1", "%/V"],
        ["Dropout voltage", "IOUT = 500 mA", "—", "180", "300", "mV"], ["Quiescent current", "IOUT = 0 mA", "—", "45", "70", "µA"],
        ["Shutdown current", "EN = 0 V", "—", "0.1", "1", "µA"], ["Current limit", "VOUT = 0 V", "520", "650", "900", "mA"],
        ["PSRR", "f = 1 kHz, IOUT = 100 mA", "—", "70", "—", "dB"], ["Output noise", "10 Hz to 100 kHz", "—", "38", "—", "µVrms"],
        ["Thermal shutdown threshold", "", "—", "160", "—", "°C"], ["EN input high threshold", "", "1.2", "—", "—", "V"], ["EN input low threshold", "", "—", "—", "0.4", "V"]],
  pins=[["1", "VIN", "Power", "Input supply. Bypass with at least 1 µF ceramic capacitor close to the pin."], ["2", "GND", "Ground", "Ground reference."],
        ["3", "EN", "Input", "Enable. Drive high (≥ 1.2 V) to enable, low (≤ 0.4 V) to shut down."], ["4", "NC", "—", "No connection. Leave floating or connect to GND."],
        ["5", "VOUT", "Power", "Regulated 3.3 V output. Bypass with at least 1 µF ceramic capacitor."]],
  thermal=[["SOT-23-5", "θJA = 220 °C/W", "2.9 × 1.6 mm"], ["DFN-6 (2×2 mm)", "θJA = 65 °C/W", "2.0 × 2.0 mm"]],
  notes=["Power dissipation is PD = (VIN − VOUT) × IOUT. Keep the junction temperature below 125 °C for rated operation; see application note AN-102 for worked examples.",
         "For lowest noise, place the 1 µF output capacitor within 3 mm of VOUT and ground it directly to the GND pin."],
  rev=[["Rev A", "2024-03-02", "Initial release"], ["Rev B", "2024-09-18", "Added DFN-6 package; updated PSRR"], ["Rev C", "2025-04-07", "Corrected dropout maximum to 300 mV"]]),

 dict(file="HM5VPD_USB-C_PD_Sink_Controller.pdf", part="HM5V-PD", title="USB Type-C Power Delivery 3.0 sink controller with I²C interface",
  features=["USB PD 3.0 sink; negotiates 5 V, 9 V, 15 V and 20 V profiles", "Up to 100 W (20 V at 5 A with an e-marked cable)", "VBUS over-voltage protection threshold: 22.0 V typical",
            "I²C control interface, 7-bit address 0x28 (0x29 when ADDR pin is high)", "I²C clock up to 400 kHz (Fast-mode)", "Four general-purpose I/O pins and an active-low INT output",
            "10-bit VBUS and IBUS monitoring ADC", "Supply: VDD 3.0 V to 5.5 V", "QFN-24 (4×4 mm) package"],
  desc="The HM5V-PD negotiates power contracts with USB-C sources and reports status over I²C. It drives an external load switch and monitors VBUS voltage and current. An internal comparator disconnects the load switch when VBUS exceeds the over-voltage threshold.",
  apps=["Laptop docks", "Power banks", "Battery chargers", "Portable test equipment"],
  order=[["HM5VPD-QFN24-T", "QFN-24 (4×4 mm)", "Tape & reel, 3000", "−40 °C to 105 °C"]],
  abs=[["VBUS to GND", "−0.3", "28", "V"], ["CC1, CC2 to GND", "−0.3", "24", "V"], ["VDD to GND", "−0.3", "6.0", "V"], ["Junction temperature TJ", "—", "150", "°C"], ["Storage temperature", "−65", "150", "°C"]],
  rec=[["VBUS operating range", "4.0", "—", "21.5", "V"], ["Supply voltage VDD", "3.0", "3.3", "5.5", "V"], ["I²C clock frequency", "—", "—", "400", "kHz"], ["Ambient temperature TA", "−40", "—", "105", "°C"]],
  elec=[["VBUS over-voltage threshold", "VBUS rising", "21.3", "22.0", "22.7", "V"], ["VBUS under-voltage lockout", "VBUS falling", "3.5", "3.7", "3.9", "V"],
        ["Supply current, attached", "VDD = 3.3 V", "—", "180", "260", "µA"], ["Supply current, detached", "VDD = 3.3 V", "—", "12", "25", "µA"],
        ["ADC resolution", "VBUS / IBUS", "—", "10", "—", "bit"], ["VBUS measurement accuracy", "4 V to 21.5 V", "−2", "—", "2", "%"],
        ["INT output low voltage", "IOL = 2 mA", "—", "—", "0.4", "V"], ["I²C address (ADDR = GND)", "7-bit", "", "0x28", "", ""], ["I²C address (ADDR = VDD)", "7-bit", "", "0x29", "", ""]],
  pins=[["1", "VBUS", "Power", "USB-C VBUS sense input."], ["2", "CC1", "I/O", "Configuration channel 1."], ["3", "CC2", "I/O", "Configuration channel 2."],
        ["5", "VDD", "Power", "3.0 V to 5.5 V supply."], ["7", "SDA", "I/O", "I²C data (open-drain)."], ["8", "SCL", "Input", "I²C clock."],
        ["9", "ADDR", "Input", "Address select: GND = 0x28, VDD = 0x29."], ["10", "INT", "Output", "Active-low interrupt (open-drain)."], ["11", "GATE", "Output", "Drives the external VBUS load switch."]],
  thermal=[["QFN-24 (4×4 mm)", "θJA = 38 °C/W", "4.0 × 4.0 mm"]],
  notes=["Place a 10 µF ceramic capacitor on VBUS and keep CC1/CC2 traces short and away from switching nodes.", "Use pull-up resistors of 2.2 kΩ on SDA and SCL when VDD = 3.3 V at 400 kHz. See AN-107 for bus design guidance."],
  rev=[["Rev A", "2024-05-10", "Initial release"], ["Rev B", "2024-12-02", "Added ADDR pin; 400 kHz I²C"], ["Rev C", "2025-06-20", "Tightened OVP threshold: 22.0 V typical (21.3 V min, 22.7 V max)"]]),

 dict(file="HT410_Digital_Temperature_Sensor.pdf", part="HT410", title="±0.5 °C digital temperature sensor with I²C interface and ALERT output",
  features=["Accuracy: ±0.5 °C maximum from −10 °C to 85 °C", "Accuracy: ±1.0 °C maximum from −40 °C to 125 °C", "12-bit resolution (0.0625 °C per LSB)", "Supply voltage: 1.7 V to 3.6 V",
            "Supply current: 3 µA average at one conversion per second", "Shutdown current: 0.5 µA", "I²C interface; four addresses 0x48 to 0x4B selected by the ADD0 pin", "Open-drain ALERT output with programmable limits", "SOT-563 (6-pin) package"],
  desc="The HT410 is a low-power digital temperature sensor for thermal management and compensation. Conversion time is 26 ms typical. An open-drain ALERT output signals when the temperature crosses programmable high and low limits.",
  apps=["Battery packs", "Wearables", "Thermal protection", "Environmental monitoring"],
  order=[["HT410-SOT563-T", "SOT-563 (6-pin)", "Tape & reel, 4000", "−40 °C to 125 °C"]],
  abs=[["VDD to GND", "−0.3", "4.0", "V"], ["SDA, SCL, ALERT to GND", "−0.3", "4.0", "V"], ["Storage temperature", "−65", "150", "°C"]],
  rec=[["Supply voltage VDD", "1.7", "3.3", "3.6", "V"], ["I²C clock frequency", "—", "—", "400", "kHz"], ["Operating temperature", "−40", "—", "125", "°C"]],
  elec=[["Temperature accuracy", "TA = −10 °C to 85 °C", "−0.5", "±0.1", "0.5", "°C"], ["Temperature accuracy", "TA = −40 °C to 125 °C", "−1.0", "±0.2", "1.0", "°C"],
        ["Resolution", "", "—", "0.0625", "—", "°C"], ["Conversion time", "", "—", "26", "35", "ms"], ["Average supply current", "1 conversion/s, VDD = 3.3 V", "—", "3", "5", "µA"],
        ["Shutdown current", "", "—", "0.5", "1.5", "µA"], ["I²C address (ADD0 = GND)", "7-bit", "", "0x48", "", ""], ["I²C address (ADD0 = VDD)", "7-bit", "", "0x49", "", ""],
        ["I²C address (ADD0 = SDA)", "7-bit", "", "0x4A", "", ""], ["I²C address (ADD0 = SCL)", "7-bit", "", "0x4B", "", ""]],
  pins=[["1", "SCL", "Input", "I²C clock."], ["2", "GND", "Ground", "Ground."], ["3", "ALERT", "Output", "Open-drain over/under-temperature alert."], ["4", "ADD0", "Input", "Address select (GND, VDD, SDA or SCL)."], ["5", "VDD", "Power", "1.7 V to 3.6 V supply."], ["6", "SDA", "I/O", "I²C data (open-drain)."]],
  thermal=[["SOT-563", "θJA = 190 °C/W", "1.6 × 1.6 mm"]],
  notes=["Self-heating is negligible at the specified sampling rate. For best accuracy, thermally couple the package to the surface being measured."],
  rev=[["Rev A", "2023-11-14", "Initial release"], ["Rev B", "2024-08-01", "Added ±0.5 °C grade"]]),

 dict(file="HB7_BLE_5.3_Module.pdf", part="HB7", title="Bluetooth Low Energy 5.3 system-on-module",
  features=["Bluetooth LE 5.3 with 1 Mbps, 2 Mbps and Coded PHY", "Transmit power up to +8 dBm", "Receiver sensitivity: −97 dBm at 1 Mbps, −103 dBm at 125 kbps (Coded)", "Supply voltage: 1.8 V to 3.6 V (absolute maximum 3.9 V)",
            "TX current: 6.4 mA at 0 dBm (3 V, DC-DC enabled)", "RX current: 5.1 mA", "Deep sleep current with RTC: 1.2 µA", "512 kB flash and 128 kB RAM", "Interfaces: SPI, I²C (400 kHz), UART, 12-bit ADC with 8 channels", "Module size 9.5 × 12.5 mm with integrated PCB antenna"],
  desc="The HB7 integrates a BLE 5.3 radio, microcontroller, crystals and antenna in a compact module. It supports over-the-air firmware updates and secure boot.",
  apps=["Asset trackers", "Wearables", "Beacons", "Smart home sensors"],
  order=[["HB7-MOD-T", "Module 9.5×12.5 mm", "Tape & reel, 1000", "−40 °C to 85 °C"]],
  abs=[["VDD to GND", "−0.3", "3.9", "V"], ["RF input power", "—", "10", "dBm"], ["Storage temperature", "−40", "125", "°C"]],
  rec=[["Supply voltage VDD", "1.8", "3.0", "3.6", "V"], ["Operating temperature", "−40", "—", "85", "°C"]],
  elec=[["TX power", "Programmable", "−20", "—", "8", "dBm"], ["RX sensitivity, 1 Mbps", "BER 0.1%", "—", "−97", "—", "dBm"], ["RX sensitivity, Coded 125 kbps", "", "—", "−103", "—", "dBm"],
        ["TX current at 0 dBm", "VDD = 3 V, DC-DC", "—", "6.4", "—", "mA"], ["RX current", "VDD = 3 V, DC-DC", "—", "5.1", "—", "mA"], ["Deep sleep current", "RTC running", "—", "1.2", "2.0", "µA"], ["ADC resolution", "", "—", "12", "—", "bit"]],
  pins=[["1", "VDD", "Power", "1.8 V to 3.6 V supply."], ["2", "GND", "Ground", "Ground."], ["3", "SWDIO", "I/O", "Serial-wire debug data."], ["4", "SWCLK", "Input", "Serial-wire debug clock."], ["5", "P0.04/SDA", "I/O", "GPIO / I²C data."], ["6", "P0.05/SCL", "I/O", "GPIO / I²C clock."], ["7", "RESET", "Input", "Active-low reset."]],
  thermal=[["Module", "θJA = 55 °C/W", "9.5 × 12.5 mm"]],
  notes=["Keep copper and metal away from the antenna end of the module. Use the HM3300 regulator for a low-noise 3.3 V rail when running from a 5 V source."],
  rev=[["Rev A", "2024-02-20", "Initial release"], ["Rev B", "2025-01-15", "Added Coded PHY sensitivity"]]),

 dict(file="HMD12_Dual_Motor_Driver.pdf", part="HMD12", title="Dual H-bridge motor driver with SPI configuration and current sensing",
  features=["Motor supply VM: 4.5 V to 18 V (absolute maximum 20 V)", "Two H-bridges: 2.5 A peak and 1.8 A RMS per channel", "RDS(on) (high + low side): 220 mΩ typical at 25 °C", "PWM frequency up to 100 kHz",
            "SPI configuration interface, clock up to 5 MHz", "Analog current-sense output per channel", "Overcurrent trip: 3.4 A typical", "Thermal shutdown at 165 °C", "Logic supply VCC: 3.0 V to 5.5 V; standby current 8 µA", "TSSOP-20 package with exposed pad"],
  desc="The HMD12 drives two brushed DC motors or one stepper motor. Fault conditions are reported on an open-drain FAULT pin and in the SPI status register.",
  apps=["Robotics", "Printers", "Camera gimbals", "Valves and actuators"],
  order=[["HMD12-TSSOP20-T", "TSSOP-20 (EP)", "Tape & reel, 2500", "−40 °C to 125 °C"]],
  abs=[["VM to GND", "−0.3", "20", "V"], ["VCC to GND", "−0.3", "6.0", "V"], ["Output current (peak, per channel)", "—", "2.5", "A"], ["Junction temperature TJ", "—", "150", "°C"]],
  rec=[["Motor supply VM", "4.5", "12", "18", "V"], ["Logic supply VCC", "3.0", "3.3", "5.5", "V"], ["PWM frequency", "—", "—", "100", "kHz"], ["SPI clock", "—", "—", "5", "MHz"]],
  elec=[["Output on-resistance (HS + LS)", "TJ = 25 °C, I = 1 A", "—", "220", "300", "mΩ"], ["Overcurrent trip threshold", "", "2.9", "3.4", "3.9", "A"], ["Thermal shutdown", "", "—", "165", "—", "°C"],
        ["Standby current (VM)", "Sleep mode", "—", "8", "15", "µA"], ["Current-sense gain", "", "—", "0.5", "—", "V/A"]],
  pins=[["1", "OUT1A", "Output", "Bridge 1, output A."], ["2", "OUT1B", "Output", "Bridge 1, output B."], ["5", "VM", "Power", "Motor supply, 4.5 V to 18 V."], ["8", "VCC", "Power", "Logic supply."], ["12", "SCK", "Input", "SPI clock."], ["13", "SDI", "Input", "SPI data in."], ["15", "FAULT", "Output", "Open-drain fault flag."]],
  thermal=[["TSSOP-20 (EP)", "θJA = 32 °C/W", "6.5 × 4.4 mm"]],
  notes=["Add at least 47 µF of bulk capacitance close to VM. Solder the exposed pad to a large ground plane for rated thermal performance."],
  rev=[["Rev A", "2024-07-01", "Initial release"]]),

 dict(file="HIMU6_6-Axis_IMU.pdf", part="HIMU6", title="6-axis inertial measurement unit (3-axis accelerometer + 3-axis gyroscope)",
  features=["Accelerometer ranges: ±2 g, ±4 g, ±8 g, ±16 g", "Gyroscope ranges: ±125, ±250, ±500, ±1000 and ±2000 dps", "Output data rate up to 6.4 kHz", "Accelerometer noise density: 90 µg/√Hz", "Gyroscope noise density: 0.007 dps/√Hz",
            "Supply VDD: 1.71 V to 3.6 V; VDDIO: 1.2 V to 3.6 V", "Current in normal mode (both sensors): 0.9 mA", "I²C up to 1 MHz (address 0x6A, or 0x6B when SDO is high) and SPI up to 10 MHz", "Two programmable interrupt pins", "LGA-14 package, 2.5 × 3.0 × 0.83 mm"],
  desc="The HIMU6 combines a MEMS accelerometer and gyroscope with a configurable FIFO, tap/step detection and motion-wake features for low-power motion sensing.",
  apps=["Wearables", "Drones", "Gaming", "Industrial vibration monitoring"],
  order=[["HIMU6-LGA14-T", "LGA-14", "Tape & reel, 5000", "−40 °C to 85 °C"]],
  abs=[["VDD to GND", "−0.3", "4.0", "V"], ["Acceleration (any axis, 0.2 ms)", "—", "10000", "g"], ["Storage temperature", "−40", "125", "°C"]],
  rec=[["Supply voltage VDD", "1.71", "1.8", "3.6", "V"], ["I/O supply VDDIO", "1.2", "1.8", "3.6", "V"], ["Operating temperature", "−40", "—", "85", "°C"]],
  elec=[["Accelerometer noise density", "±4 g range", "—", "90", "—", "µg/√Hz"], ["Gyroscope noise density", "±2000 dps range", "—", "0.007", "—", "dps/√Hz"], ["Current, both sensors", "Normal mode, ODR 104 Hz", "—", "0.9", "1.1", "mA"],
        ["Current, accelerometer only", "Low-power mode", "—", "25", "—", "µA"], ["Maximum output data rate", "", "—", "6.4", "—", "kHz"], ["I²C address (SDO = GND)", "7-bit", "", "0x6A", "", ""], ["I²C address (SDO = VDDIO)", "7-bit", "", "0x6B", "", ""]],
  pins=[["1", "SDO/SA0", "Input", "SPI data out / I²C address bit."], ["2", "SDx", "I/O", "Aux sensor data."], ["4", "INT1", "Output", "Programmable interrupt 1."], ["5", "VDDIO", "Power", "I/O supply."], ["8", "VDD", "Power", "Core supply."], ["13", "SCL/SPC", "Input", "I²C clock / SPI clock."], ["14", "SDA/SDI", "I/O", "I²C data / SPI data in."]],
  thermal=[["LGA-14", "θJA = 90 °C/W", "2.5 × 3.0 mm"]],
  notes=["Mount the sensor away from components that generate mechanical stress. Calibrate zero-g offset after reflow."],
  rev=[["Rev A", "2024-10-05", "Initial release"], ["Rev B", "2025-03-11", "Added 6.4 kHz output data rate"]]),

 dict(file="HF16_SPI_NOR_Flash.pdf", part="HF16", title="16 Mbit (2 MB) serial NOR flash memory",
  features=["Supply voltage: 2.7 V to 3.6 V", "Clock frequency up to 104 MHz (Fast Read); Dual and Quad I/O supported", "100,000 program/erase cycles", "Data retention: 20 years", "Page program time: 0.7 ms typical (3 ms maximum)",
            "4 KB sector erase: 45 ms typical (400 ms maximum)", "Chip erase: 8 s typical (30 s maximum)", "Standby current: 15 µA; deep power-down: 1 µA", "WSON-8 (6×5 mm) and SOIC-8 packages", "Industrial grade −40 °C to 85 °C; automotive HF16-A −40 °C to 105 °C"],
  desc="The HF16 is a 16 Mbit SPI NOR flash with a unique 64-bit ID, security registers and software write protection.",
  apps=["Firmware storage", "Boot code", "Data logging", "Configuration storage"],
  order=[["HF16-WSON8-T", "WSON-8 (6×5 mm)", "Tape & reel, 3000", "−40 °C to 85 °C"], ["HF16-SOIC8-T", "SOIC-8", "Tape & reel, 2500", "−40 °C to 85 °C"], ["HF16A-WSON8-T", "WSON-8 (6×5 mm)", "Tape & reel, 3000", "−40 °C to 105 °C"]],
  abs=[["VCC to GND", "−0.5", "4.2", "V"], ["Voltage on any pin", "−0.5", "VCC + 0.4", "V"], ["Storage temperature", "−65", "150", "°C"]],
  rec=[["Supply voltage VCC", "2.7", "3.3", "3.6", "V"], ["SPI clock (Fast Read)", "—", "—", "104", "MHz"], ["Operating temperature (industrial)", "−40", "—", "85", "°C"]],
  elec=[["Endurance", "Program/erase cycles", "100000", "—", "—", "cycles"], ["Data retention", "At 55 °C", "20", "—", "—", "years"], ["Page program time", "256 bytes", "—", "0.7", "3", "ms"], ["Sector erase time", "4 KB", "—", "45", "400", "ms"],
        ["Chip erase time", "", "—", "8", "30", "s"], ["Standby current", "CS high", "—", "15", "30", "µA"], ["Deep power-down current", "", "—", "1", "5", "µA"]],
  pins=[["1", "CS#", "Input", "Chip select, active low."], ["2", "DO/IO1", "I/O", "Data out / IO1."], ["3", "WP#/IO2", "I/O", "Write protect / IO2."], ["4", "GND", "Ground", "Ground."], ["5", "DI/IO0", "I/O", "Data in / IO0."], ["6", "CLK", "Input", "Serial clock."], ["7", "HOLD#/IO3", "I/O", "Hold / IO3."], ["8", "VCC", "Power", "2.7 V to 3.6 V supply."]],
  thermal=[["WSON-8 (6×5 mm)", "θJA = 45 °C/W", "6.0 × 5.0 mm"], ["SOIC-8", "θJA = 125 °C/W", "5.0 × 4.0 mm"]],
  notes=["Use the HM3300 regulator to provide a clean 3.3 V supply to the flash and microcontroller. Pull CS# up to VCC during power-up."],
  rev=[["Rev A", "2023-08-30", "Initial release"], ["Rev B", "2024-06-12", "Added automotive grade HF16-A"]]),

 dict(file="HAC24_24-bit_Audio_Codec.pdf", part="HAC24", title="24-bit, 192 kHz stereo audio codec with headphone driver",
  features=["ADC signal-to-noise ratio: 104 dB (A-weighted)", "DAC signal-to-noise ratio: 110 dB (A-weighted)", "THD+N: −95 dB", "Sample rates from 8 kHz to 192 kHz", "Digital audio interfaces: I²S, left-justified and TDM",
            "Control interface: I²C, address 0x1A (0x1B when CS pin is high)", "Analog supply AVDD: 3.0 V to 3.6 V (3.3 V nominal); digital core DVDD: 1.65 V to 1.95 V", "Headphone driver: 60 mW into 32 Ω at 3.3 V", "Playback power consumption: 18 mW", "QFN-32 (5×5 mm) package"],
  desc="The HAC24 is a high-performance stereo codec for portable audio. It includes a programmable gain amplifier, a headphone amplifier and a low-latency digital filter option.",
  apps=["Portable audio", "Voice assistants", "Conferencing", "Musical instruments"],
  order=[["HAC24-QFN32-T", "QFN-32 (5×5 mm)", "Tape & reel, 3000", "−40 °C to 85 °C"]],
  abs=[["AVDD to AGND", "−0.3", "4.0", "V"], ["DVDD to DGND", "−0.3", "2.2", "V"], ["Storage temperature", "−65", "150", "°C"]],
  rec=[["Analog supply AVDD", "3.0", "3.3", "3.6", "V"], ["Digital core DVDD", "1.65", "1.8", "1.95", "V"], ["Operating temperature", "−40", "—", "85", "°C"]],
  elec=[["ADC SNR", "A-weighted, 1 kHz", "—", "104", "—", "dB"], ["DAC SNR", "A-weighted, 1 kHz", "—", "110", "—", "dB"], ["THD+N", "−1 dBFS", "—", "−95", "—", "dB"], ["Headphone output power", "32 Ω load, AVDD = 3.3 V", "—", "60", "—", "mW"],
        ["Maximum sample rate", "", "—", "192", "—", "kHz"], ["I²C address (CS = GND)", "7-bit", "", "0x1A", "", ""], ["I²C address (CS = DVDD)", "7-bit", "", "0x1B", "", ""]],
  pins=[["1", "MCLK", "Input", "Master clock."], ["2", "BCLK", "I/O", "Bit clock."], ["3", "LRCLK", "I/O", "Left/right (frame) clock."], ["4", "SDIN", "Input", "Serial data in (DAC)."], ["5", "SDOUT", "Output", "Serial data out (ADC)."], ["12", "SCL", "Input", "I²C clock."], ["13", "SDA", "I/O", "I²C data."], ["14", "CS", "Input", "I²C address select."]],
  thermal=[["QFN-32 (5×5 mm)", "θJA = 34 °C/W", "5.0 × 5.0 mm"]],
  notes=["Provide a low-noise AVDD (for example from the HM3300 regulator) and keep analog and digital grounds joined at a single point under the device."],
  rev=[["Rev A", "2024-04-22", "Initial release"], ["Rev B", "2025-02-03", "Added TDM mode"]]),
]

for p in PARTS:
    build_datasheet(p)


def simple_pdf(name, title, blocks, tables=None):
    path = os.path.join(OUT, name)
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm, title=title)
    s = [Paragraph(title, H1), Paragraph("Halcyon Micro — fictional company, synthetic document", SUB)]
    for kind, content in blocks:
        if kind == "h": s.append(Paragraph(content, H2))
        elif kind == "p": s.append(Paragraph(content, BODY)); s.append(Spacer(1, 4))
        elif kind == "t": s.append(table(content[0], content[1])); s.append(Spacer(1, 6))
    doc.build(s, onFirstPage=footer(title, ""), onLaterPages=footer(title, ""))
    print("wrote", name)


simple_pdf("Halcyon_Product_Selection_Guide.pdf", "Halcyon Product Selection Guide 2025", [
    ("p", "A quick comparison of the Halcyon Micro catalogue. See each part's datasheet for full specifications and conditions."),
    ("h", "Selection table"),
    ("t", ([["Part", "Function", "Supply range", "Interface", "Package", "Temperature range"],
            ["HM3300", "3.3 V LDO regulator, 500 mA", "2.5 V to 6.0 V", "EN pin", "SOT-23-5 / DFN-6", "−40 °C to 125 °C"],
            ["HM5V-PD", "USB-C PD 3.0 sink controller", "VDD 3.0 V to 5.5 V", "I²C (0x28 / 0x29)", "QFN-24", "−40 °C to 105 °C"],
            ["HT410", "Digital temperature sensor, ±0.5 °C", "1.7 V to 3.6 V", "I²C (0x48–0x4B)", "SOT-563", "−40 °C to 125 °C"],
            ["HB7", "BLE 5.3 module, +8 dBm", "1.8 V to 3.6 V", "SPI / I²C / UART", "Module 9.5×12.5 mm", "−40 °C to 85 °C"],
            ["HMD12", "Dual H-bridge motor driver, 2.5 A", "VM 4.5 V to 18 V", "SPI", "TSSOP-20 (EP)", "−40 °C to 125 °C"],
            ["HIMU6", "6-axis IMU", "1.71 V to 3.6 V", "I²C (0x6A / 0x6B) / SPI", "LGA-14", "−40 °C to 85 °C"],
            ["HF16", "16 Mbit SPI NOR flash", "2.7 V to 3.6 V", "SPI / Dual / Quad", "WSON-8 / SOIC-8", "−40 °C to 85 °C (A grade 105 °C)"],
            ["HAC24", "24-bit 192 kHz audio codec", "AVDD 3.0 V to 3.6 V", "I²S / TDM, I²C (0x1A / 0x1B)", "QFN-32", "−40 °C to 85 °C"]],
           [20, 42, 30, 32, 26, 30])),
    ("h", "Reference designs"),
    ("p", "Wearable sensor node: HB7 + HT410 + HIMU6, powered from a single cell through an HM3300. Dock: HM5V-PD with a 20 V buck stage. Audio: HAC24 with HM3300 on AVDD.")])

simple_pdf("AN-102_Thermal_Design_Guidelines.pdf", "AN-102 Thermal Design Guidelines", [
    ("h", "Junction temperature"),
    ("p", "The junction temperature is TJ = TA + PD × θJA, where PD is the power dissipated in the device and θJA is the junction-to-ambient thermal resistance of the package on a standard JEDEC board."),
    ("h", "Linear regulator dissipation"),
    ("p", "For a linear regulator, PD = (VIN − VOUT) × IOUT plus the quiescent term VIN × IQ, which is negligible at load."),
    ("h", "Worked example: HM3300"),
    ("p", "VIN = 5.0 V, VOUT = 3.3 V, IOUT = 400 mA gives PD = (5.0 − 3.3) × 0.4 = 0.68 W. In the SOT-23-5 package (θJA = 220 °C/W) the temperature rise is 0.68 × 220 = 149.6 °C, which exceeds the 125 °C limit even at TA = 25 °C. In the DFN-6 package (θJA = 65 °C/W) the rise is 44.2 °C, so TJ = 69.2 °C at TA = 25 °C and the design is within limits."),
    ("h", "Package thermal resistance summary"),
    ("t", ([["Part", "Package", "θJA (°C/W)"], ["HM3300", "SOT-23-5", "220"], ["HM3300", "DFN-6 (2×2 mm)", "65"], ["HM5V-PD", "QFN-24", "38"], ["HT410", "SOT-563", "190"], ["HMD12", "TSSOP-20 (EP)", "32"], ["HIMU6", "LGA-14", "90"], ["HF16", "WSON-8", "45"], ["HF16", "SOIC-8", "125"], ["HAC24", "QFN-32", "34"]], [40, 60, 40])),
    ("h", "Layout recommendations"),
    ("p", "Use a solid copper pour under exposed pads, add thermal vias (0.3 mm drill, 1.0 mm pitch) beneath QFN and TSSOP exposed pads, and keep heat-generating devices away from the HT410 temperature sensor.")])

simple_pdf("AN-107_I2C_Bus_Design_Notes.pdf", "AN-107 I²C Bus Design Notes", [
    ("h", "Device addresses"),
    ("p", "Avoid address conflicts by consulting the table below before connecting devices to the same bus."),
    ("t", ([["Device", "7-bit address(es)", "Selection"], ["HM5V-PD", "0x28 or 0x29", "ADDR pin: GND = 0x28, VDD = 0x29"], ["HT410", "0x48, 0x49, 0x4A, 0x4B", "ADD0 pin: GND, VDD, SDA, SCL"], ["HIMU6", "0x6A or 0x6B", "SDO pin: GND = 0x6A, VDDIO = 0x6B"], ["HAC24", "0x1A or 0x1B", "CS pin: GND = 0x1A, DVDD = 0x1B"], ["HB7", "—", "Acts as I²C master only"]], [30, 45, 85])),
    ("h", "Pull-up resistor sizing"),
    ("p", "The maximum pull-up value is RP(max) = tr / (0.8473 × CB), where tr is the allowed rise time (300 ns for 400 kHz Fast-mode, 120 ns for 1 MHz Fast-mode Plus) and CB is the bus capacitance. For CB = 100 pF at 400 kHz, RP(max) is about 3.5 kΩ; 2.2 kΩ is a good default at 3.3 V."),
    ("h", "Speed limits"),
    ("p", "HT410, HM5V-PD and HB7 support up to 400 kHz. HIMU6 supports up to 1 MHz. Do not mix 1 MHz devices on a bus with 400 kHz devices unless the master runs at 400 kHz.")])

# ── non-PDF documents ──
with open(os.path.join(OUT, "ReleaseNotes_and_Errata.md"), "w", encoding="utf-8") as f:
    f.write("""# Halcyon Micro — Release Notes and Errata (2025)

## HM5V-PD
- **Rev B (errata):** On parts from date codes before 2447, the VBUS over-voltage threshold may measure as low as 21.8 V typical. This is corrected in Rev C, which guarantees 22.0 V typical (21.3 V min, 22.7 V max).
- Workaround for Rev B: set the OVP margin register to +1 step over I2C address 0x28.

## HIMU6
- Rev B adds the 6.4 kHz output data rate. Rev A parts are limited to 1.6 kHz.

## HM3300
- Rev C corrects the datasheet dropout maximum to 300 mV at 500 mA. Silicon is unchanged.

## General
- All parts are RoHS compliant and halogen-free.
- Samples ship within 3 business days; production lead time is 12 weeks.
""")
with open(os.path.join(OUT, "FAQ.txt"), "w", encoding="utf-8") as f:
    f.write("""Halcyon Micro - Frequently Asked Questions

Q: Can the HM3300 power the HB7 BLE module directly?
A: Yes. The HM3300 delivers up to 500 mA at 3.3 V, well above the HB7 peak transmit current of about 6.4 mA at 0 dBm. The HB7 supply range is 1.8 V to 3.6 V.

Q: Which parts share I2C bus addresses?
A: None of the standard addresses conflict. See AN-107 for the full address table.

Q: What is the maximum clock speed of the HF16 flash?
A: 104 MHz for Fast Read. Dual and Quad I/O modes are also supported.

Q: Do you offer automotive-grade parts?
A: The HF16-A flash is rated -40 C to 105 C. Other parts are industrial grade.

Q: Where can I find 3D models?
A: Models are available on request from the Halcyon applications team.
""")
with open(os.path.join(OUT, "ordering-codes.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["order_code", "part", "package", "reel_qty", "min_order_qty", "lifecycle"])
    for r in [["HM3300-SOT5-T", "HM3300", "SOT-23-5", 3000, 3000, "Active"], ["HM3300-DFN6-T", "HM3300", "DFN-6", 5000, 5000, "Active"], ["HM5VPD-QFN24-T", "HM5V-PD", "QFN-24", 3000, 3000, "Active"],
              ["HT410-SOT563-T", "HT410", "SOT-563", 4000, 4000, "Active"], ["HB7-MOD-T", "HB7", "Module", 1000, 1000, "Active"], ["HMD12-TSSOP20-T", "HMD12", "TSSOP-20", 2500, 2500, "Active"],
              ["HIMU6-LGA14-T", "HIMU6", "LGA-14", 5000, 5000, "Active"], ["HF16-WSON8-T", "HF16", "WSON-8", 3000, 3000, "Active"], ["HF16-SOIC8-T", "HF16", "SOIC-8", 2500, 2500, "Not recommended for new designs"],
              ["HF16A-WSON8-T", "HF16", "WSON-8", 3000, 3000, "Active"], ["HAC24-QFN32-T", "HAC24", "QFN-32", 3000, 3000, "Active"]]:
        w.writerow(r)
print("wrote md / txt / csv")

# DOCX
import docx
d = docx.Document()
d.add_heading("Halcyon Wearable Sensor Node — Design Review Checklist", 1)
d.add_paragraph("Reference design: HB7 + HT410 + HIMU6 powered through an HM3300. Synthetic document.")
d.add_heading("Power", 2)
d.add_paragraph("Confirm the HM3300 input is at most 6.0 V and that the DFN-6 package is used when dissipation exceeds 0.4 W.")
d.add_paragraph("Confirm total 3.3 V load stays below the 500 mA output limit of the HM3300.")
t = d.add_table(rows=1, cols=3)
t.style = "Light Grid Accent 1"
for i, h in enumerate(["Block", "Typical current", "Notes"]): t.rows[0].cells[i].text = h
for r in [["HB7 (TX 0 dBm)", "6.4 mA", "Average is lower with 1 s advertising interval"], ["HIMU6 (both sensors)", "0.9 mA", "Normal mode, 104 Hz"], ["HT410 (1 conv/s)", "3 µA", "Shutdown 0.5 µA"], ["HF16 standby", "15 µA", "Deep power-down 1 µA"]]:
    row = t.add_row().cells
    for i, v in enumerate(r): row[i].text = v
d.add_heading("Interfaces", 2)
d.add_paragraph("Verify the I²C addresses on the shared bus: HT410 at 0x48, HIMU6 at 0x6A. Pull-ups of 2.2 kΩ to 3.3 V.")
d.save(os.path.join(OUT, "Design_Review_Checklist.docx"))

# XLSX
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Power budget"
ws.append(["Block", "Supply (V)", "Typical current (mA)", "Peak current (mA)", "Notes"])
for r in [["HB7 BLE module", 3.0, 6.4, 8.0, "TX 0 dBm, DC-DC on"], ["HIMU6 IMU", 1.8, 0.9, 1.1, "Normal mode"], ["HT410 sensor", 3.3, 0.003, 0.005, "1 conversion/s"], ["HF16 flash (read)", 3.3, 4.0, 12.0, "33 MHz read"], ["HAC24 codec (playback)", 3.3, 5.5, 18.0, "18 mW typical"]]:
    ws.append(r)
ws2 = wb.create_sheet("Rails")
ws2.append(["Rail", "Source", "Max current (mA)"]); ws2.append(["3.3 V", "HM3300", 500]); ws2.append(["1.8 V", "Buck (external)", 300])
wb.save(os.path.join(OUT, "Power_Budget.xlsx"))

# PPTX
from pptx import Presentation
pr = Presentation()
s1 = pr.slides.add_slide(pr.slide_layouts[1]); s1.shapes.title.text = "Halcyon Micro 2025 Portfolio"
s1.placeholders[1].text = "Eight parts covering power, sensing, wireless, motion and audio.\nAll parts are fictional demo content."
s2 = pr.slides.add_slide(pr.slide_layouts[1]); s2.shapes.title.text = "Why HM3300?"
s2.placeholders[1].text = "Low quiescent current: 45 µA typical\nDropout: 180 mV typical at 500 mA\nPackages: SOT-23-5 and DFN-6"
pr.save(os.path.join(OUT, "Portfolio_Overview.pptx"))
print("wrote docx / xlsx / pptx")
