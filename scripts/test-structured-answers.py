#!/usr/bin/env python3
"""Lightweight regression checks for structured-answers logic (no Node required)."""
import re
import json

UK_POSTCODE = re.compile(r"\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b", re.I)
DOB = re.compile(
    r"\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{2,4}|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b",
    re.I,
)


def parse_money(text: str):
    gbp = re.search(r"£\s*([\d,]+(?:\.\d+)?)\s*(k|m|thousand|million)?", text, re.I)
    if gbp:
        n = float(gbp.group(1).replace(",", ""))
        suf = (gbp.group(2) or "").lower()
        if suf in ("k", "thousand"):
            n *= 1000
        if suf in ("m", "million"):
            n *= 1_000_000
        return int(round(n))
    return None


def extract(field_key: str, value: str) -> dict:
    text = (value or "").strip()
    if not text:
        return {}
    if field_key == "full_name":
        parts = re.sub(r"Captured[^:]+:\s*", "", text, flags=re.I).split()
        return {"first_name": parts[0], "surname": " ".join(parts[1:])} if len(parts) >= 2 else {"first_name": parts[0]}
    if field_key == "date_of_birth":
        m = DOB.search(text)
        return {"date_of_birth": m.group(1)} if m else {}
    if field_key == "home":
        m = UK_POSTCODE.search(text)
        return {"postcode": m.group(1).upper()} if m else {}
    if field_key == "mortgage_need":
        amounts = [parse_money(m.group(0)) for m in re.finditer(r"£\s*[\d,]+", text)]
        amounts = [a for a in amounts if a]
        term = re.search(r"\b(\d{1,2})\s*(?:year|yr|years)\b", text, re.I)
        purpose = "first purchase" if re.search(r"first[- ]?(time|home|buyer)", text, re.I) else None
        ptype = "flat" if re.search(r"\bflat\b", text, re.I) else None
        out = {}
        if purpose:
            out["purpose"] = purpose
        if amounts:
            out["property_price_gbp"] = amounts[0]
        if len(amounts) > 1:
            out["deposit_gbp"] = amounts[1]
        if term:
            out["mortgage_term_years"] = int(term.group(1))
        if ptype:
            out["property_type"] = ptype
        return out
    if field_key == "work":
        income = parse_money(text)
        status = "employed" if re.search(r"employ", text, re.I) else None
        out = {}
        if status:
            out["employment_status"] = status
        if income:
            out["annual_income_gbp"] = income
        return out
    return {}


def assert_eq(label, got, expected):
    if got != expected:
        raise AssertionError(f"{label}: got {got!r}, expected {expected!r}")


def main():
    mortgage = extract(
        "mortgage_need",
        "First time buyer, buying a flat at £350,000 with £70,000 deposit over 25 years",
    )
    assert_eq("property_price", mortgage.get("property_price_gbp"), 350000)
    assert_eq("deposit", mortgage.get("deposit_gbp"), 70000)
    assert_eq("term", mortgage.get("mortgage_term_years"), 25)
    assert_eq("purpose", mortgage.get("purpose"), "first purchase")
    assert_eq("type", mortgage.get("property_type"), "flat")

    work = extract("work", "Employed at Acme Ltd as an engineer, earning £65,000 a year")
    assert_eq("employment", work.get("employment_status"), "employed")
    assert_eq("income", work.get("annual_income_gbp"), 65000)

    home = extract("home", "12 High Street, Manchester M1 1AA")
    assert "postcode" in home

    name = extract("full_name", "John Smith")
    assert_eq("first", name.get("first_name"), "John")
    assert_eq("surname", name.get("surname"), "Smith")

    print("All structured-answer checks passed.")


if __name__ == "__main__":
    main()
