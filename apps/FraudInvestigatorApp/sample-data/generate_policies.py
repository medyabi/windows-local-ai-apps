import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

OUT = os.path.dirname(os.path.abspath(__file__))

def write_pdf(filename, title, sections):
    path = os.path.join(OUT, filename)
    c = canvas.Canvas(path, pagesize=A4)
    width, height = A4
    margin = 50
    y = height - 60

    def newpage():
        nonlocal y
        c.showPage()
        y = height - 60

    c.setFont("Helvetica-Bold", 16)
    c.drawString(margin, y, title)
    y -= 34

    for heading, body_lines in sections:
        if y < 100:
            newpage()
        c.setFont("Helvetica-Bold", 12)
        c.drawString(margin, y, heading)
        y -= 20
        c.setFont("Helvetica", 10.5)
        for line in body_lines:
            if y < 70:
                newpage()
            c.drawString(margin, y, line)
            y -= 15
        y -= 12

    c.save()
    print("Wrote", path)

def wrap(text, width=95):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines

# ═══════════════════════════════════════════════════
#  AML Policy
# ═══════════════════════════════════════════════════
write_pdf("AML_Policy.pdf", "Anti-Money Laundering (AML) Policy", [
    ("1. Purpose", wrap(
        "This policy establishes the bank's framework for detecting, preventing, and reporting "
        "money laundering and terrorist financing activity in accordance with applicable regulation. "
        "It applies to all customer-facing staff, fraud analysts, and compliance officers.")),
    ("2. Structuring and Threshold Avoidance", wrap(
        "Transactions structured to fall just below regulatory reporting thresholds (for example, "
        "multiple transfers of amounts just under EUR 5,000 within a short period) must be treated as "
        "a red flag for structuring. When an analyst identifies three or more transactions within a "
        "seven-day window that are each within 10 percent of a known reporting threshold, the case "
        "must be escalated to a Senior AML Analyst within one business day.")),
    ("3. Rapid Movement of Funds", wrap(
        "Funds that move through three or more accounts within a short time window (typically under "
        "one hour), especially when crossing jurisdictions, are considered high-risk layering activity. "
        "Analysts must trace the full transaction chain and document the originating and terminating "
        "accounts before closing or escalating the alert.")),
    ("4. Unrelated Senders to a Single Account (Fan-in)", wrap(
        "An account that receives funds from five or more apparently unrelated customers within a "
        "30-day period, particularly if the funds are redistributed shortly after receipt, must be "
        "investigated as a potential money mule account. The receiving account should be flagged and "
        "reviewed for a Suspicious Activity Report (SAR) regardless of the individual transaction sizes.")),
    ("5. Escalation and Reporting", wrap(
        "Analysts must never characterize a flagged case as confirmed fraud or money laundering in "
        "system notes. Findings should be described as potentially suspicious and requiring further "
        "review. A SAR may only be filed following review and sign-off by a Compliance Officer.")),
])

# ═══════════════════════════════════════════════════
#  KYC Policy
# ═══════════════════════════════════════════════════
write_pdf("KYC_Policy.pdf", "Know Your Customer (KYC) Policy", [
    ("1. Customer Identification", wrap(
        "All customers must be identified using a government-issued identification document at "
        "account opening. Identification records must be refreshed at minimum every three years for "
        "standard-risk customers and annually for high-risk customers.")),
    ("2. Ongoing Due Diligence", wrap(
        "Customer risk profiles must be reassessed whenever a significant deviation from historical "
        "transaction behavior is detected, including new beneficiary countries, large increases in "
        "transaction volume, or new counterparties that do not match the customer's declared "
        "occupation or business activity.")),
    ("3. Enhanced Due Diligence Triggers", wrap(
        "Enhanced Due Diligence (EDD) is required when a customer's account shows: (a) a sudden large "
        "transaction following a long period of dormancy, (b) transactions to or from a jurisdiction "
        "not previously associated with the customer, or (c) declared income that is materially "
        "inconsistent with observed account activity.")),
    ("4. Beneficiary Verification", wrap(
        "New beneficiaries receiving transfers above EUR 3,000 for the first time should be verified "
        "against the customer's stated purpose of payment. Analysts should request supporting "
        "documentation when the relationship between customer and beneficiary is unclear.")),
])

# ═══════════════════════════════════════════════════
#  Transaction Monitoring Procedures
# ═══════════════════════════════════════════════════
write_pdf("Transaction_Monitoring_Procedures.pdf", "Transaction Monitoring Procedures", [
    ("1. Alert Triage", wrap(
        "All system-generated alerts must be triaged within one business day. Alerts with a computed "
        "risk score of 70 or above are considered high priority and must be reviewed the same day they "
        "are generated.")),
    ("2. Evidence Standards", wrap(
        "Every finding recorded against a case must be supported by specific transaction evidence: "
        "timestamp, amount, sender account, receiver account, and country. Narrative conclusions "
        "without linked evidence are not acceptable for case closure.")),
    ("3. Geographic Risk Review", wrap(
        "A transaction to a country not previously observed in a customer's history should be treated "
        "as a moderate risk indicator on its own, and a high risk indicator when combined with an "
        "unusual amount or a new beneficiary.")),
    ("4. Case Documentation", wrap(
        "Analysts must record: the alert type, the supporting evidence, the actions taken, and the "
        "final disposition (confirmed suspicious activity, false positive, or referred for further "
        "review). Cases must never be closed without a documented rationale.")),
])

# ═══════════════════════════════════════════════════
#  Fraud Investigation Handbook
# ═══════════════════════════════════════════════════
write_pdf("Fraud_Investigation_Handbook.pdf", "Fraud Investigation Handbook", [
    ("1. Investigator Conduct", wrap(
        "Investigators assist in identifying potentially suspicious activity. The determination of "
        "whether activity constitutes fraud is made by Compliance and, where applicable, law "
        "enforcement — never by the investigating analyst alone or by an automated system.")),
    ("2. Account Takeover Indicators", wrap(
        "A customer whose transaction history consists of small, regular payments and who suddenly "
        "initiates a large transfer from a new device, new location, or new country should be treated "
        "as a possible account takeover. The account should be temporarily flagged for step-up "
        "verification before further large transactions are permitted.")),
    ("3. Using AI-Assisted Analysis", wrap(
        "AI tools may be used to summarize evidence, explain detected patterns, and draft investigation "
        "reports. AI-generated explanations must always be reviewed by the analyst before being relied "
        "upon, and must never be presented to a customer or regulator as a final determination of fraud.")),
    ("4. Report Structure", wrap(
        "Investigation reports should include: an executive summary, key findings with supporting "
        "evidence, and recommended next steps for the analyst. Reports should avoid definitive "
        "language such as 'this is fraud' and instead describe findings as warranting further review.")),
])

print("Done.")
