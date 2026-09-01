"""
EVS configuration accessors.

All feature flags and tunables live in the DB (evs_config, evs_mining_config,
evs_allocations, evs_sale_config) — never hard-coded, per the brief. Routes
call get_config() at the start of every request rather than caching flags in
process memory, so an admin flipping mining_enabled=false takes effect on
the very next request, not after a restart.
"""

from main import supabase  # reuse the existing app's Supabase client — no second client/project


def get_config() -> dict:
    res = supabase.table("evs_config").select("*").eq("id", 1).limit(1).execute()
    if not res.data:
        raise RuntimeError("evs_config row missing — run the EVS migration.")
    return res.data[0]


def get_mining_config() -> dict:
    res = supabase.table("evs_mining_config").select("*").eq("id", 1).limit(1).execute()
    if not res.data:
        raise RuntimeError("evs_mining_config row missing — run the EVS migration.")
    return res.data[0]


def get_allocations() -> dict:
    res = supabase.table("evs_allocations").select("*").eq("id", 1).limit(1).execute()
    if not res.data:
        raise RuntimeError("evs_allocations row missing — run the EVS migration.")
    return res.data[0]


def get_sale_config() -> dict:
    res = supabase.table("evs_sale_config").select("*").eq("id", 1).limit(1).execute()
    if not res.data:
        raise RuntimeError("evs_sale_config row missing — run the EVS migration.")
    return res.data[0]
