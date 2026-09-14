#!/usr/bin/env python3
"""
refresh_fpl_data.py — rebuild data.json from the live Fantasy Premier League API.

    python3 refresh_fpl_data.py            # writes ./data.json
    python3 refresh_fpl_data.py path/to/data.json

Run it hourly with cron:
    0 * * * * cd /srv/touchline && /usr/bin/python3 refresh_fpl_data.py

Or let the included GitHub Action do it (.github/workflows/refresh.yml).
Only dependency: requests
"""
import datetime, json, sys
import requests

API = "https://fantasy.premierleague.com/api"
HDRS = {"User-Agent": "Mozilla/5.0 (touchline-refresh)"}
MIN_MINUTES = 0           # every player in the game is included
SHRINK = 0.70             # weight on a club's own xGC vs the league mean


def per90(el):
    return max(el["minutes"], 1) / 90.0


def build():
    boot = requests.get(f"{API}/bootstrap-static/", headers=HDRS, timeout=30).json()
    fix = requests.get(f"{API}/fixtures/", headers=HDRS, timeout=30).json()

    played = sum(1 for e in boot["events"] if e["finished"]) or 1
    nxt = (next((e["id"] for e in boot["events"] if e.get("is_next")), None)
           or next((e["id"] for e in boot["events"] if not e["finished"]), 1))

    # club expected goals conceded per 90, from settled defenders and keepers
    acc = {}
    for el in boot["elements"]:
        if el["minutes"] < 300 or el["element_type"] > 2:
            continue
        acc.setdefault(el["team"], []).append(float(el["expected_goals_conceded"]) / per90(el))
    means = {t: sum(v) / len(v) for t, v in acc.items()}
    league = sum(means.values()) / len(means) if means else 1.3

    teams = [{
        "id": t["id"], "n": t["short_name"], "name": t["name"],
        "sh": t["strength_overall_home"], "sa": t["strength_overall_away"],
        # permanent club code — what FPL keys its shirt images on
        "code": t["code"],
        "xgc": round(SHRINK * means.get(t["id"], league) + (1 - SHRINK) * league, 3),
        "xg": 1.2,
    } for t in boot["teams"]]

    players = []
    for el in boot["elements"]:
        if el["minutes"] < MIN_MINUTES:
            continue
        m = per90(el)
        players.append({
            "i": el["id"], "c": el["code"], "n": el["web_name"], "t": el["team"],
            "p": el["element_type"], "cost": el["now_cost"] / 10,
            "tp": el["total_points"], "mn": el["minutes"], "st": el["starts"],
            "xg": round(float(el["expected_goals"]) / m, 3),
            "xa": round(float(el["expected_assists"]) / m, 3),
            "dc": round(el["defensive_contribution"] / m, 2),
            "sv": round(el["saves"] / m, 2),
            "bo": round(el["bonus"] / m, 3),
            "yc": round(el["yellow_cards"] / m, 3),
            "f": float(el["form"]), "sel": float(el["selected_by_percent"]),
            "pen": el["penalties_order"] or 0,
            # availability: status flag plus FPL's own chance-of-playing percentage
            "s": el["status"],
            "ch": el["chance_of_playing_next_round"],
        })

    fixtures = [{"gw": f["event"], "h": f["team_h"], "a": f["team_a"]}
                for f in fix if f["event"] and not f["finished"]]

    return {
        "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
        "nextGw": nxt, "gwPlayed": played,
        "teams": teams, "fixtures": fixtures, "players": players,
    }


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "data.json"
    data = build()
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"{out}: {len(data['players'])} players, {len(data['fixtures'])} fixtures, "
          f"{data['gwPlayed']} gameweeks played, next GW{data['nextGw']}.")


if __name__ == "__main__":
    main()
0 * * * * cd /srv/touchline && python3 refresh_fpl_data.py data.json

data.json