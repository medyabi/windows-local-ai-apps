import random
import os
from datetime import datetime, timedelta

random.seed(42)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_CSV = os.path.join(HERE, "sample-transactions.csv")
OUT_PROFILES = os.path.join(HERE, "customer-profiles.csv")
START = datetime(2026, 3, 1)
END = datetime(2026, 9, 19)

COUNTRIES = ["FR", "DE", "ES", "IT", "NL", "BE", "UK"]
MERCHANTS = ["Retail", "Groceries", "Utilities", "Transport", "Dining", "Subscription", "N/A"]
MERCHANT_PURPOSE = {
    "Retail": "Retail purchase", "Groceries": "Grocery purchase", "Utilities": "Utility bill payment",
    "Transport": "Transport payment", "Dining": "Dining payment", "Subscription": "Subscription payment", "N/A": "N/A",
}
TYPES_SPEND = ["PAYMENT", "POS", "WITHDRAWAL"]
TRANSFER_PURPOSES = ["Rent payment", "Family support", "Loan repayment", "Business payment", "Savings transfer"]
VAGUE_PURPOSES = ["Other", "Personal transfer", "N/A"]

FIRST_NAMES = ["Elena", "Marco", "Sofia", "Ahmed", "Priya", "Jonas", "Lucia", "Karim", "Hannah", "Mateus",
               "Ingrid", "Youssef", "Chiara", "Erik", "Amara", "Pavel", "Noor", "Felix", "Zara", "Tomas",
               "Isabel", "Rashid", "Greta", "Dario", "Nadia", "Sven", "Layla", "Anton", "Mira", "Bruno"]
LAST_NAMES = ["Rossi", "Nowak", "Dubois", "Mueller", "Garcia", "Silva", "Kowalski", "Hansen", "Bianchi", "Schmidt",
              "Andersen", "Costa", "Novak", "Weber", "Moreau", "Larsen", "Ferrari", "Meyer", "Lund", "Okafor",
              "Petrov", "Lindqvist", "Rasmussen", "Conti", "Berg", "Haddad", "Sorensen", "Marino", "Wagner", "Roux"]
OCCUPATIONS = ["Software Engineer", "Retail Manager", "Registered Nurse", "Accountant", "Teacher",
               "Sales Representative", "Civil Servant", "Electrician", "Small Business Owner", "Consultant",
               "Graphic Designer", "Logistics Coordinator", "Marketing Manager", "Administrative Assistant"]

rows = []
profile_rows = []
txn_counter = 10001
used_names = set()

def new_txn_id():
    global txn_counter
    txn_counter += 1
    return "TX" + str(txn_counter)

def rand_dt(a, b):
    delta = b - a
    seconds = random.randint(0, int(delta.total_seconds()))
    return a + timedelta(seconds=seconds)

def rand_person_name():
    while True:
        name = random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES)
        if name not in used_names:
            used_names.add(name)
            return name

# ── counterparty (receiver) name/BIC registry — consistent per account code ──
counterparty_registry = {}
BIC_BANKS = ["DEUTDEFF", "BNPAFRPP", "INGBNL2A", "UBSWCHZH", "BARCGB22", "UNCRITMM", "SANTESMM", "MTLNLUXX", "COBADEFF", "ABNANL2A"]

def counterparty_for(acct, kind="business"):
    if acct in counterparty_registry:
        return counterparty_registry[acct]
    if kind == "person":
        name = rand_person_name()
        bic = "N/A"
    else:
        suffixes = ["Trading Ltd", "Holdings SA", "Consulting GmbH", "Ventures BV", "Capital Partners", "Trust Ltd", "Group SRL"]
        name = random.choice(LAST_NAMES) + " " + random.choice(suffixes)
        bic = random.choice(BIC_BANKS)
    counterparty_registry[acct] = (name, bic)
    return counterparty_registry[acct]

def add_row(customer_id, ts, amount, ttype, sender, receiver, country, merchant, channel, purpose=None, receiver_kind="business"):
    if purpose is None:
        purpose = MERCHANT_PURPOSE.get(merchant, "N/A") if ttype != "TRANSFER" else random.choice(TRANSFER_PURPOSES)
    if ttype == "SALARY":
        rname, rbic = "N/A", "N/A"  # receiver is the customer's own account
    else:
        rname, rbic = counterparty_for(receiver, receiver_kind)
    rows.append([new_txn_id(), customer_id, ts.strftime("%Y-%m-%d %H:%M"), f"{amount:.2f}", "EUR", ttype,
                 sender, receiver, rname, rbic, country, purpose, merchant, channel])

def add_profile(cid, name, occupation, expected_volume, risk_rating, pep):
    profile_rows.append([cid, name, occupation, f"{expected_volume:.2f}", risk_rating, pep])

def pick_risk_rating():
    r = random.random()
    if r < 0.80: return "LOW"
    if r < 0.95: return "MEDIUM"
    return "HIGH"

# ═══════════════════════════════════════════════════
#  150 baseline customers with normal activity
# ═══════════════════════════════════════════════════
NUM_CUSTOMERS = 150
customer_ids = [f"C-{10100+i}" for i in range(NUM_CUSTOMERS)]
customer_accounts = {}
customer_home_country = {}

for cid in customer_ids:
    acct = "A" + str(random.randint(10000, 99999))
    customer_accounts[cid] = acct
    home = random.choice(COUNTRIES)
    customer_home_country[cid] = home
    n_txns = random.randint(12, 28)
    base_amount = random.uniform(30, 600)
    for _ in range(n_txns):
        ts = rand_dt(START, END)
        amount = round(random.uniform(base_amount * 0.4, base_amount * 1.8), 2)
        ttype = random.choice(TYPES_SPEND)
        merchant = random.choice(MERCHANTS)
        receiver = "M" + str(random.randint(1000, 9999))
        add_row(cid, ts, -amount, ttype, acct, receiver, home, merchant, random.choice(["ONLINE", "BRANCH", "MOBILE", "ATM"]))
    has_salary = random.random() < 0.6
    salary = round(random.uniform(1800, 5200), 2) if has_salary else 0
    if has_salary:
        for m in range(6):
            ts = START + timedelta(days=27 + m * 30, hours=random.randint(8, 11))
            if ts > END:
                break
            add_row(cid, ts, salary, "SALARY", "EMPLOYER" + str(random.randint(1, 40)), acct, home, "N/A", "ONLINE")
    # declared expected monthly volume tracks real baseline activity (±30%) — most customers
    # will NOT trigger the "actual vs declared" deviation check.
    est_monthly = (base_amount * n_txns / 6.0) + (salary if has_salary else 0)
    expected = max(150.0, est_monthly * random.uniform(0.75, 1.3))
    add_profile(cid, rand_person_name(), random.choice(OCCUPATIONS), expected, pick_risk_rating(), "YES" if random.random() < 0.03 else "NO")

# ═══════════════════════════════════════════════════
#  SCENARIO A — Rapid fund movement (customer, chain through 3 accounts)
# ═══════════════════════════════════════════════════
cidA = "C-20001"
acctA = customer_accounts.get(cidA, "A55001")
customer_accounts[cidA] = acctA
customer_home_country[cidA] = "FR"
for _ in range(10):
    ts = rand_dt(START, START + timedelta(days=150))
    add_row(cidA, ts, -round(random.uniform(20, 150), 2), "POS", acctA, "M" + str(random.randint(1000, 9999)), "FR", random.choice(MERCHANTS), "ONLINE")
base = datetime(2026, 9, 12, 10, 31)
add_row(cidA, base, -8500.00, "TRANSFER", acctA, "B84301", "FR", "N/A", "ONLINE", purpose="Other")
add_row(cidA, base + timedelta(minutes=11), -7900.00, "TRANSFER", "B84301", "B90112", "LU", "N/A", "ONLINE", purpose="Other")
add_row(cidA, base + timedelta(minutes=33), -7500.00, "TRANSFER", "B90112", "B98433", "UK", "N/A", "ONLINE", purpose="Other")
add_profile(cidA, rand_person_name(), "Graphic Designer", 320.0, "LOW", "NO")

# ═══════════════════════════════════════════════════
#  SCENARIO B — Structuring (amounts just under threshold)
# ═══════════════════════════════════════════════════
cidB = "C-20002"
acctB = "A55002"
customer_accounts[cidB] = acctB
customer_home_country[cidB] = "DE"
for _ in range(10):
    ts = rand_dt(START, START + timedelta(days=150))
    add_row(cidB, ts, -round(random.uniform(20, 150), 2), "POS", acctB, "M" + str(random.randint(1000, 9999)), "DE", random.choice(MERCHANTS), "ONLINE")
struct_start = datetime(2026, 8, 3, 9, 0)
for i, amt in enumerate([4800.00, 4900.00, 4700.00, 4850.00]):
    ts = struct_start + timedelta(days=i, hours=random.randint(0, 5))
    add_row(cidB, ts, -amt, "TRANSFER", acctB, "B71200", "DE", "N/A", "BRANCH", purpose="Personal transfer")
add_profile(cidB, rand_person_name(), "Administrative Assistant", 280.0, "LOW", "NO")

# ═══════════════════════════════════════════════════
#  SCENARIO C — Mule network (fan-in): receives from 7 unrelated customers
# ═══════════════════════════════════════════════════
mule_acct = "B99000"
mule_senders = random.sample(customer_ids, 7)
for i, cid in enumerate(mule_senders):
    acct = customer_accounts[cid]
    ts = datetime(2026, 8, 20) + timedelta(days=i, hours=random.randint(8, 18))
    add_row(cid, ts, -round(random.uniform(1200, 3400), 2), "TRANSFER", acct, mule_acct, customer_home_country[cid], "N/A", "ONLINE", purpose="Other")
cid_mule_owner = "C-20003"
customer_accounts[cid_mule_owner] = mule_acct
customer_home_country[cid_mule_owner] = "UK"
for _ in range(4):
    ts = datetime(2026, 8, 27) + timedelta(hours=random.randint(0, 48))
    add_row(cid_mule_owner, ts, -round(random.uniform(2000, 5000), 2), "TRANSFER", mule_acct, "B" + str(random.randint(10000, 99999)), "UK", "N/A", "ONLINE", purpose="Other")
add_profile(cid_mule_owner, rand_person_name(), "Retail Manager", 1500.0, "LOW", "NO")

# ═══════════════════════════════════════════════════
#  SCENARIO D — Account takeover
# ═══════════════════════════════════════════════════
cidD = "C-20004"
acctD = "A55004"
customer_accounts[cidD] = acctD
customer_home_country[cidD] = "NL"
for _ in range(18):
    ts = rand_dt(START, START + timedelta(days=170))
    add_row(cidD, ts, -round(random.uniform(20, 200), 2), "POS", acctD, "M" + str(random.randint(1000, 9999)), "NL", random.choice(MERCHANTS), "MOBILE")
takeover_ts = datetime(2026, 9, 5, 3, 14)
add_row(cidD, takeover_ts, -8900.00, "TRANSFER", acctD, "B60219", "UK", "N/A", "ONLINE", purpose="Other")
add_profile(cidD, rand_person_name(), "Teacher", 210.0, "LOW", "NO")

# ═══════════════════════════════════════════════════
#  SCENARIO E — Dormancy then spike
# ═══════════════════════════════════════════════════
cidE = "C-20005"
acctE = "A55005"
customer_accounts[cidE] = acctE
customer_home_country[cidE] = "ES"
for _ in range(8):
    ts = rand_dt(START, START + timedelta(days=60))
    add_row(cidE, ts, -round(random.uniform(30, 180), 2), "POS", acctE, "M" + str(random.randint(1000, 9999)), "ES", random.choice(MERCHANTS), "BRANCH")
spike_ts = datetime(2026, 9, 15, 14, 0)
add_row(cidE, spike_ts, -6200.00, "TRANSFER", acctE, "B70044", "ES", "N/A", "ONLINE", purpose="Other")
add_profile(cidE, rand_person_name(), "Electrician", 150.0, "LOW", "NO")

# ═══════════════════════════════════════════════════
#  Write files
# ═══════════════════════════════════════════════════
rows.sort(key=lambda r: r[2])
with open(OUT_CSV, "w", encoding="utf-8") as f:
    f.write("transaction_id,customer_id,timestamp,amount,currency,transaction_type,sender_account,receiver_account,receiver_name,receiver_bic,country,purpose,merchant,channel\n")
    for r in rows:
        f.write(",".join(r) + "\n")

with open(OUT_PROFILES, "w", encoding="utf-8") as f:
    f.write("customer_id,name,occupation,expected_monthly_volume,risk_rating,pep_status\n")
    for r in profile_rows:
        f.write(",".join(r) + "\n")

print("Wrote", OUT_CSV, "with", len(rows), "transactions across", len(set(r[1] for r in rows)), "customers")
print("Wrote", OUT_PROFILES, "with", len(profile_rows), "customer profiles")
