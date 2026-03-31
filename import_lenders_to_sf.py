import json, re, subprocess, sys

with open("lenders.json") as f:
    data = json.load(f)

lenders = data["rows"]
created = 0
errors = 0

for l in lenders:
    name = l["name"]
    contact = l.get("contact_info") or ""
    reqs = l.get("requirements") or ""
    notes = l.get("notes") or ""
    tier = l.get("tier") or ""

    # Parse emails and phones
    emails = re.findall(r"[\w.+-]+@[\w.-]+\.\w+", contact)
    phones = re.findall(r"[\d\-\.\(\)\+]{7,}", contact)

    # Parse requirements
    min_rev = None
    min_tib = None
    min_fico = None
    max_amount = None
    term_range = None
    positions = None
    states_restricted = ""

    for part in reqs.replace("\n", " / ").split("/"):
        part = part.strip()
        pl = part.lower()
        if "monthly revenue" in pl:
            m = re.search(r"\$?([\d,]+)\s*[kK]?", part)
            if m:
                val = m.group(1).replace(",", "")
                if "k" in part.lower() and len(val) < 4:
                    val = val + "000"
                try:
                    min_rev = int(val)
                except:
                    pass
        if "time in business" in pl or "tib:" in pl:
            m = re.search(r"(\d+)\s*(year|month)", pl)
            if m:
                val = float(m.group(1))
                if "month" in m.group(2):
                    val = val / 12
                min_tib = val
        if "fico" in pl:
            m = re.search(r"(\d{3})", part)
            if m:
                min_fico = int(m.group(1))
        if ("funding amount" in pl or "max" in pl) and "$" in part:
            m = re.search(r"\$([\d,]+)", part)
            if m:
                try:
                    max_amount = int(m.group(1).replace(",", ""))
                except:
                    pass
        if "term" in pl and ("month" in pl or re.search(r"\d", part)):
            term_range = part.strip()[:255]
        if "position" in pl:
            m = re.search(r"(\d+)\s*[-–]\s*(\d+)", part)
            if m:
                try:
                    positions = int(m.group(2))
                except:
                    pass
            else:
                m2 = re.search(r"(\d+)", part)
                if m2:
                    try:
                        positions = int(m2.group(1))
                    except:
                        pass
        if "not fund" in pl or "prohibited state" in pl:
            states_restricted = part.strip()[:255]

    # Parse prohibited industries from notes
    industries_restricted = ""
    for line in notes.split("\n"):
        if "prohibited" in line.lower() and "industr" in line.lower():
            industries_restricted = line.split(":", 1)[-1].strip() if ":" in line else line

    # Build SF record values string
    fields = [f"Name='{name.replace(chr(39), '')}'"]
    fields.append(f"Lender_Name__c='{name.replace(chr(39), '')}'")
    fields.append("Type=Lender")
    fields.append("Lender_Type__c='Direct Funder'")
    fields.append("Lender_Status__c=Active")

    if emails:
        fields.append(f"Submission_Email__c={emails[0]}")
    if len(emails) > 1:
        fields.append(f"Submission_Email_2__c={emails[1]}")
    if phones:
        fields.append(f"General_Support_Phone__c={phones[0]}")
    if tier:
        # Map compound tiers to highest
        first_tier = tier.split("-")[0].strip()
        tier_val = {"A": "Tier A", "B": "Tier B", "C": "Tier C", "D": "Tier D"}.get(first_tier, "")
        if tier_val:
            fields.append(f"Lender_Priority_Tier__c='{tier_val}'")
    if min_rev:
        fields.append(f"Min_Monthly_Revenue__c={min_rev}")
    if min_tib:
        fields.append(f"Min_Time_in_Business__c={min_tib}")
    if min_fico:
        fields.append(f"Min_Credit_Score__c={min_fico}")
    if max_amount:
        fields.append(f"Max_Advance_Amount__c={max_amount}")
    if term_range:
        fields.append(f"Term_Range__c='{term_range.replace(chr(39), '')}'")
    if positions:
        fields.append(f"Max_Positions_Allowed__c={positions}")
    if states_restricted:
        fields.append(f"States_Restricted__c='{states_restricted[:255].replace(chr(39), '')}'")
    if industries_restricted:
        fields.append(f"Industries_Restricted__c='{industries_restricted[:1000].replace(chr(39), '')}'")
    if notes:
        # Escape for shell
        clean_notes = notes[:2000].replace("'", "").replace('"', "").replace("\n", " | ")
        fields.append(f"Notes_General__c='{clean_notes}'")
    if reqs:
        clean_reqs = reqs[:2000].replace("'", "").replace('"', "").replace("\n", " | ")
        fields.append(f"Additional_Docs_Required__c='{clean_reqs}'")

    values_str = " ".join(fields)

    cmd = f'sf data create record --sobject Account --values "{values_str}" --target-org tcg-sandbox --json'

    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            out = json.loads(result.stdout)
            rec_id = out.get("result", {}).get("id", "?")
            print(f"  Created: {name} ({rec_id})")
            created += 1
        else:
            err_msg = result.stderr[:200] if result.stderr else result.stdout[:200]
            print(f"  FAILED: {name} — {err_msg}")
            errors += 1
    except Exception as e:
        print(f"  ERROR: {name} — {e}")
        errors += 1

print(f"\nDone! Created: {created}, Errors: {errors}")
