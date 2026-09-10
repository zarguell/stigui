"""CISA ScubaGear M365 Secure Configuration Baseline converter.

Parses the baseline Markdown documents published in
cisagov/ScubaGear (PowerShell/ScubaGear/baselines/*.md) and maps them
into the site's XCCDF-shaped Benchmark JSON. The key set mirrors
src/api/generated/Stig.ts exactly — see map.py.
"""
