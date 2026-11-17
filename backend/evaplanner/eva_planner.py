import csv
import heapq
import math

import numpy as np
from scipy.ndimage import gaussian_filter

from .real_hardness import real_hardness

DAY_CSV_PATH = "crater_themis_dayir_10km.csv"
NIGHT_CSV_PATH = "crater_themis_nightir_10km.csv"

# ==============================================================================
# ENTRÉES DE MISSION (à terme : fournies par l'interface graphique)
#   MODE "pieton" : tout le trajet à pied, START -> TARGET
#   MODE "rover"  : conduite aussi loin que possible vers TARGET, retour au dernier
#                   terrain plat, stationnement, puis finition à pied PARK -> TARGET
# ==============================================================================
MODE = "rover"
START = (350, 60)        # (ligne, colonne)
TARGET = (180, 196)      # (ligne, colonne)

# ==============================================================================
# DONNÉES
# ==============================================================================
CSV_PATH = "crater_altitudes_slopes_10km.csv"
DUST_CSV_PATH = "crater_tes_dust_scored_10km.csv"
DX = 24.0                      # Résolution d'un pixel (m)

# --- Règles de mission (HYPOTHÈSES, à ajuster) ---
R_EXCLUDE_M = 500.0            # Le rover ne s'approche jamais à moins de cette distance de TARGET
PARK_MAX_SLOPE_DEG = 8.0       # Pente maximale (lissée) d'une case de stationnement
T_SAMPLE_MIN = 20.0            # Durée de prélèvement sur place (min)

NEIGHBORS = [(-1, 0), (1, 0), (0, -1), (0, 1),
             (-1, -1), (-1, 1), (1, -1), (1, 1)]

# ==============================================================================
# ROVER
# ==============================================================================
MAX_SLOPE_ROVER_TAN = math.tan(math.radians(12.0))   # Pente frontale maximale
MAX_ROLL_DEG = 18.0            # Pente locale maximale (proxy du devers)
M_ROVER = 450.0
G_MARS = 3.72
MOTOR_EFF = 0.75
P_AVIONICS_W = 150.0           # Avionique en roulage
P_PARKED_W = 150.0             # HYPOTHÈSE : avionique pendant que le rover attend l'EVA
V_MAX_ROVER = 3.0
C_MIN_ROVER = 65.0             # Minimum réel du modèle = 68 J/m -> heuristique admissible
K_DUST = 0.03                  # HYPOTHÈSE : surcoût max de c_rr pour dust_score = 1
DUST_SMOOTH_PX = 20            # Lissage de la poussière (20 px = 480 m)

# ==============================================================================
# PIÉTON (EVA)
# ==============================================================================
MAX_SLOPE_WALK_TAN = math.tan(math.radians(20.0))
W_BODY = 75.0
L_SUIT = 70.0
G_RATIO = 0.379                # g Mars / g Terre
M_SUIT_W = 120.0
V_MAX_WALK = 1.2
C_MIN_WALK = 125.0             # = 150 W / 1.2 m/s : minimum réel du modèle (admissible)
M_TOTAL = W_BODY + L_SUIT
M_POSTURE = G_RATIO * (1.5 * W_BODY + 2.0 * M_TOTAL * (L_SUIT / W_BODY) ** 2)
P_STAND_W = M_SUIT_W + M_POSTURE   # Puissance métabolique à l'arrêt (prélèvement)


# ==============================================================================
# BLOC 1 : CHARGEMENT ET COUCHES
# ==============================================================================
def load_grid(csv_file: str, column: str) -> np.ndarray:
    """Lit une colonne d'un CSV (row, col, ...) et reconstruit la matrice 2D."""
    rows, cols, vals = [], [], []
    with open(csv_file, newline="", encoding="utf-8-sig") as f:
        for rec in csv.DictReader(f):
            rows.append(int(float(rec["row"])))
            cols.append(int(float(rec["col"])))
            vals.append(float(rec[column]))
    grid = np.full((max(rows) + 1, max(cols) + 1), np.nan, dtype=np.float32)
    grid[rows, cols] = vals
    if np.isnan(grid).any():
        grid = np.nan_to_num(grid, nan=float(np.nanmean(grid)))
    return grid


def synthetic_hardness(altitude: np.ndarray, dx: float = DX, seed: int = 42):
    """Dureté [0.05, 1.0] dérivée du relief. 0 = sable meuble, 1 = roche.
    PROXY SYNTHÉTIQUE : à remplacer / fusionner avec l'inertie thermique (fuse_hardness)."""
    z = altitude.astype(np.float64)
    gy, gx = np.gradient(gaussian_filter(z, 1.5), dx, dx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    zc = gaussian_filter(z, 6)
    lap = (np.roll(zc, 1, 0) + np.roll(zc, -1, 0)
           + np.roll(zc, 1, 1) + np.roll(zc, -1, 1) - 4 * zc) / dx ** 2
    convex = -lap                                  # >0 = crête, <0 = cuvette
    rel = z - gaussian_filter(z, 40)               # altitude relative (~1 km)

    def nz(a, p=2):
        lo, hi = np.percentile(a, [p, 100 - p])
        return np.clip((a - lo) / (hi - lo), 0, 1)

    rng = np.random.default_rng(seed)
    noise = nz(gaussian_filter(rng.standard_normal(z.shape), 5))

    hard = (0.30 + 0.30 * nz(slope) + 0.15 * nz(convex) + 0.15 * nz(rel) + 0.10 * noise)
    hard = gaussian_filter(hard, 2)                # lissage ~100 m (THEMIS)
    return np.clip(hard, 0.05, 1.0).astype(np.float32)


def fuse_hardness(h_relief, thermal_inertia=None, w_thermal=0.6):
    """Point d'entrée pour le thermique. thermal_inertia : forte = roche, faible = sable.
    (Si tu as un dT, convertis-le d'abord en pseudo-inertie : dT fort = inertie faible.)"""
    if thermal_inertia is None:
        return h_relief
    lo, hi = np.nanpercentile(thermal_inertia, [2, 98])
    ti = gaussian_filter(np.clip((np.nan_to_num(thermal_inertia, nan=lo) - lo) / (hi - lo), 0, 1), 2)
    return np.clip(w_thermal * ti + (1 - w_thermal) * h_relief, 0.05, 1.0).astype(np.float32)


def load_dust(csv_file: str, shape: tuple) -> np.ndarray:
    """dust_score = CLASSE ordinale (0, 1/3, 2/3, 1), pas une grandeur physique.
    Renvoie la version lissée (la donnée brute est en blocs de ~5 km)."""
    raw = load_grid(csv_file, "dust_score")
    if raw.shape != shape:
        raise ValueError(f"Grille poussière {raw.shape} différente de la grille altitude {shape}.")
    return gaussian_filter(raw, DUST_SMOOTH_PX, mode="nearest").astype(np.float32)


def build_context() -> dict:
    """Charge et prépare toutes les couches (indépendantes de START et TARGET)."""
    altitude = load_grid(CSV_PATH, "elevation_m")
    hardness = real_hardness(DAY_CSV_PATH, NIGHT_CSV_PATH, altitude.shape)
    #hardness = fuse_hardness(synthetic_hardness(altitude), thermal_inertia=None) DONNEES SYNTHETIQUES
    dust_smooth = load_dust(DUST_CSV_PATH, altitude.shape)

    gy, gx = np.gradient(altitude, DX)
    gys, gxs = np.gradient(gaussian_filter(altitude, 1.5), DX)
    return {
        "altitude": altitude,
        "x_m": load_grid(CSV_PATH, "x_m"),
        "y_m": load_grid(CSV_PATH, "y_m"),
        "hardness": hardness,
        "dust_smooth": dust_smooth,
        "eta": (1.8 - 0.7 * hardness).astype(np.float32),                               # piéton : SANS poussière
        "c_rr": (0.25 - 0.21 * hardness + K_DUST * dust_smooth).astype(np.float32),     # rover : avec poussière
        "c_rr_nodust": (0.25 - 0.21 * hardness).astype(np.float32),
        "local_slope_deg": np.degrees(np.arctan(np.hypot(gx, gy))),
        "local_slope_smooth": np.degrees(np.arctan(np.hypot(gxs, gys))),                # pour le stationnement
    }


# ==============================================================================
# BLOC 2 : COÛTS DE PAS (ROVER ET PIÉTON)
# ==============================================================================
def step_cost_rover(u, v, altitude, c_rr):
    """(énergie batterie J, temps s) pour un pas orienté u -> v."""
    uy, ux = u
    vy, vx = v
    dist = DX * math.hypot(vx - ux, vy - uy)
    tan_theta = float(altitude[vy, vx] - altitude[uy, ux]) / dist
    if abs(tan_theta) > MAX_SLOPE_ROVER_TAN:
        return float("inf"), 0.0

    theta = math.atan(tan_theta)
    c = float(c_rr[vy, vx])
    v_rover = max((V_MAX_ROVER / (1.0 + 4.0 * c)) * math.exp(-4.0 * abs(tan_theta)), 0.15)
    f_traction = max(M_ROVER * G_MARS * (c * math.cos(theta) + math.sin(theta)), 0.0)
    power_w = P_AVIONICS_W + (f_traction * v_rover) / MOTOR_EFF
    return (power_w / v_rover) * dist, dist / v_rover


def step_cost_walk(u, v, altitude, eta):
    """(énergie métabolique J, temps s) pour un pas orienté u -> v (Pandolf + Santee, Tobler)."""
    uy, ux = u
    vy, vx = v
    dist = DX * math.hypot(vx - ux, vy - uy)
    tan_theta = float(altitude[vy, vx] - altitude[uy, ux]) / dist
    if abs(tan_theta) > MAX_SLOPE_WALK_TAN:
        return float("inf"), 0.0

    grade_pct = 100.0 * tan_theta
    v_walk = max(V_MAX_WALK * math.exp(-3.5 * abs(tan_theta + 0.05)), 0.1)
    eta_v = float(eta[vy, vx])
    m_walk = eta_v * M_TOTAL * (1.5 * v_walk ** 2 + G_RATIO * 0.35 * v_walk * grade_pct)
    power_w = M_SUIT_W + M_POSTURE + m_walk

    if grade_pct < 0.0:   # correction de Santee en descente
        power_w -= G_RATIO * eta_v * (
            (v_walk * grade_pct * M_TOTAL) / 3.5
            - (M_TOTAL * (grade_pct + 6.0) ** 2) / W_BODY
            + (25.0 - v_walk ** 2))

    power_w = max(power_w, 150.0)
    return (power_w / v_walk) * dist, dist / v_walk


# ==============================================================================
# BLOC 3 : A* GÉNÉRIQUE (avec repli "case atteignable la plus proche du but")
# ==============================================================================
def reconstruct(came_from: dict, u):
    path = [u]
    while u in came_from:
        u = came_from[u]
        path.append(u)
    return path[::-1]


def astar(start, goal, step_fn, blocked, c_min, closest_if_unreachable=False):
    """Renvoie (chemin, but_atteint).
    Si le but est inatteignable et closest_if_unreachable=True, l'exploration couvre toute la zone
    accessible et le chemin renvoyé mène à la case la plus proche du but (distance euclidienne)."""
    h, w = blocked.shape

    def heur(p):
        return c_min * DX * math.hypot(goal[1] - p[1], goal[0] - p[0])

    open_set = [(heur(start), 0.0, start)]
    g_score = {start: 0.0}
    came_from = {}
    best = (math.hypot(goal[1] - start[1], goal[0] - start[0]), 0.0, start)

    while open_set:
        _, g_u, u = heapq.heappop(open_set)
        if u == goal:
            return reconstruct(came_from, u), True
        if g_u > g_score.get(u, float("inf")):
            continue

        d_goal = math.hypot(goal[1] - u[1], goal[0] - u[0])
        if (d_goal, g_u) < best[:2]:
            best = (d_goal, g_u, u)

        for dy, dx in NEIGHBORS:
            v = (u[0] + dy, u[1] + dx)
            if not (0 <= v[0] < h and 0 <= v[1] < w) or blocked[v]:
                continue
            e_step, _ = step_fn(u, v)
            if e_step == float("inf"):
                continue
            tentative = g_u + e_step
            if tentative < g_score.get(v, float("inf")):
                g_score[v] = tentative
                came_from[v] = u
                heapq.heappush(open_set, (tentative + heur(v), tentative, v))

    if closest_if_unreachable:
        return reconstruct(came_from, best[2]), False
    return None, False


# ==============================================================================
# BLOC 4 : STATIONNEMENT PAR REBROUSSEMENT
# ==============================================================================
def find_parking_index(path, local_slope_smooth):
    """Rebrousse depuis le bout du chemin rover jusqu'à la première case 'plate' :
    pente lissée <= PARK_MAX_SLOPE_DEG sur toute la fenêtre 3x3 (pas en bord de pente).
    Renvoie l'indice dans `path` (0 = START si rien ne convient)."""
    h, w = local_slope_smooth.shape
    for i in range(len(path) - 1, -1, -1):
        y, x = path[i]
        win = local_slope_smooth[max(y - 1, 0):min(y + 2, h), max(x - 1, 0):min(x + 2, w)]
        if win.max() <= PARK_MAX_SLOPE_DEG:
            return i
    return 0


# ==============================================================================
# BLOC 5 : BILANS
# ==============================================================================
def leg_totals(path, step_fn):
    """(énergie J, temps s, distance m) à l'aller, puis énergie et temps au retour (pas inversés)."""
    e = t = d = e_b = t_b = 0.0
    for a, b in zip(path[:-1], path[1:]):
        e_s, t_s = step_fn(a, b)
        e += e_s
        t += t_s
        d += DX * math.hypot(b[0] - a[0], b[1] - a[1])
        e_r, t_r = step_fn(b, a)
        e_b += e_r
        t_b += t_r
    return e, t, d, e_b, t_b


def cumulatives(path, step_fn):
    cum_e, cum_t, cum_d = [0.0], [0.0], [0.0]
    for a, b in zip(path[:-1], path[1:]):
        e, t = step_fn(a, b)
        cum_e.append(cum_e[-1] + e)
        cum_t.append(cum_t[-1] + t)
        cum_d.append(cum_d[-1] + DX * math.hypot(b[0] - a[0], b[1] - a[1]))
    return np.array(cum_e), np.array(cum_t), np.array(cum_d)


def life_support(energy_j):
    """O2 (kg) et eau (kg) à partir de l'énergie métabolique."""
    return 7.1e-8 * energy_j, energy_j / 2.26e6


# ==============================================================================
# BLOC 6 : PLANIFICATION D'UNE MISSION (point d'entrée pour l'interface)
# ==============================================================================
def plan_mission(ctx: dict, start: tuple, target: tuple, mode: str) -> dict:
    """Planifie une mission et renvoie un dictionnaire de résultats.
    Lève ValueError / RuntimeError avec un message clair si la mission est impossible."""
    if mode not in ("rover", "pieton"):
        raise ValueError("mode doit valoir 'rover' ou 'pieton'.")
    altitude = ctx["altitude"]
    h, w = altitude.shape
    for name, p in (("START", start), ("TARGET", target)):
        if not (0 <= p[0] < h and 0 <= p[1] < w):
            raise ValueError(f"{name} {p} est hors de la grille {h} x {w}.")

    def f_rover(a, b):
        return step_cost_rover(a, b, altitude, ctx["c_rr"])

    def f_walk(a, b):
        return step_cost_walk(a, b, altitude, ctx["eta"])

    yy, xx = np.indices((h, w))
    in_exclusion = DX * np.hypot(yy - target[0], xx - target[1]) < R_EXCLUDE_M
    blocked_rover = ((ctx["hardness"] < 0.15) | (ctx["local_slope_deg"] > MAX_ROLL_DEG) | in_exclusion)
    blocked_walk = np.zeros((h, w), dtype=bool)

    res = {"mode": mode, "start": start, "target": target, "park": None, "rover_path": None,
           "reached_by_rover": None, "blocked_rover": blocked_rover, "in_exclusion": in_exclusion,
           "f_rover": f_rover, "f_walk": f_walk}

    if mode == "pieton":
        walk_start = start
    else:
        if blocked_rover[start]:
            raise ValueError("START est bloqué pour le rover (pente, sol ou zone d'exclusion).")
        path_full, reached = astar(start, target, f_rover, blocked_rover, C_MIN_ROVER,
                                   closest_if_unreachable=True)
        k = find_parking_index(path_full, ctx["local_slope_smooth"])
        res["rover_path"] = path_full[:k + 1]
        res["park"] = res["rover_path"][-1]
        res["reached_by_rover"] = reached
        res["no_flat_found"] = (k == 0 and len(path_full) > 1)
        walk_start = res["park"]

    path_walk, _ = astar(walk_start, target, f_walk, blocked_walk, C_MIN_WALK)
    if path_walk is None:
        raise RuntimeError("TARGET est inatteignable à pied depuis le point de départ de la marche "
                           "(pente > 20° sur tout accès possible).")
    res["walk_path"] = path_walk

    # --- Bilan marche + prélèvement ---
    e_w, t_w, d_w, e_wb, t_wb = leg_totals(path_walk, f_walk)
    t_sample = T_SAMPLE_MIN * 60.0
    e_meta = e_w + e_wb + P_STAND_W * t_sample
    o2_kg, h2o_kg = life_support(e_meta)
    eva_s = t_w + t_wb + t_sample
    res.update(walk_dist_m=d_w, walk_out=(t_w, e_w), walk_back=(t_wb, e_wb), eva_s=eva_s,
               e_meta_j=e_meta, o2_kg=o2_kg, h2o_kg=h2o_kg)

    # --- Bilan rover ---
    if mode == "rover":
        rp = res["rover_path"]
        e_r, t_r, d_r, e_rb, t_rb = leg_totals(rp, f_rover)
        e_idle = P_PARKED_W * eva_s
        e_nodust = sum(step_cost_rover(a, b, altitude, ctx["c_rr_nodust"])[0] for a, b in zip(rp[:-1], rp[1:]))
        pr, pc = zip(*rp)
        res.update(rover_dist_m=d_r, rover_out=(t_r, e_r), rover_back=(t_rb, e_rb), e_idle_j=e_idle,
                   battery_wh=(e_r + e_rb + e_idle) / 3600.0, mission_s=t_r + eva_s + t_rb,
                   dust_max=float(ctx["dust_smooth"][pr, pc].max()),
                   dust_mean=float(ctx["dust_smooth"][pr, pc].mean()),
                   dust_effect_wh=(e_r - e_nodust) / 3600.0)

    segments = []
    if mode == "rover":
        segments.append(("rover", "batterie", res["rover_path"], f_rover))
    segments.append(("pieton", "metabolique", path_walk, f_walk))
    res["segments"] = segments
    return res


def print_report(res: dict):
    print(f"[MISSION] Mode {res['mode']} | START {res['start']} -> TARGET {res['target']}")
    if res["mode"] == "rover":
        t_r, e_r = res["rover_out"]
        t_rb, e_rb = res["rover_back"]
        print(f"[ROVER] But atteint en rover : "
              f"{'oui' if res['reached_by_rover'] else 'non (repli sur la case la plus proche)'}")
        if res["no_flat_found"]:
            print("[ATTENTION] Aucun terrain plat sur le trajet : le rover reste au départ.")
        print(f"[ROVER] Stationnement : {res['park']} | distance {res['rover_dist_m']:.0f} m | "
              f"aller {t_r / 60:.1f} min, {e_r / 3600:.1f} Wh | retour {t_rb / 60:.1f} min, {e_rb / 3600:.1f} Wh")
        print(f"[ROVER] Avionique à l'arrêt pendant l'EVA ({res['eva_s'] / 60:.0f} min) : "
              f"{res['e_idle_j'] / 3600:.1f} Wh")
        print(f"[ROVER] Batterie totale : {res['battery_wh']:.1f} Wh")
        print(f"[MISSION] Durée totale : {res['mission_s'] / 60:.0f} min")
        print(f"[POUSSIÈRE] Sous le trajet rover : max {res['dust_max']:.2f}, moyenne {res['dust_mean']:.2f} "
              f"| effet sur l'aller : {res['dust_effect_wh']:+.2f} Wh")
    t_w, e_w = res["walk_out"]
    t_wb, e_wb = res["walk_back"]
    print(f"[EVA]   Marche : {res['walk_dist_m']:.0f} m aller | aller {t_w / 60:.1f} min, {e_w / 1000:.1f} kJ | "
          f"retour {t_wb / 60:.1f} min, {e_wb / 1000:.1f} kJ | prélèvement {T_SAMPLE_MIN:.0f} min")
    print(f"[EVA]   Durée EVA : {res['eva_s'] / 60:.0f} min | métabolique : {res['e_meta_j'] / 1000:.0f} kJ | "
          f"O2 : {res['o2_kg']:.3f} kg | Eau : {res['h2o_kg']:.3f} kg")


# ==============================================================================
# BLOC 7 : EXPORT ET AFFICHAGE
# ==============================================================================
def export_route(ctx: dict, res: dict, out_csv="route_eva.csv"):
    """Temps et distance cumulés sur toute la mission aller ; énergie cumulée par phase."""
    t0 = d0 = 0.0
    with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.writer(f)
        wr.writerow(["phase", "energy_type", "i", "row", "col", "x_m", "y_m", "elevation_m",
                     "hardness", "dust_smooth", "cum_dist_m", "cum_time_min", "cum_energy_Wh"])
        for phase, etype, path, fn in res["segments"]:
            ce, ct, cd = cumulatives(path, fn)
            for i, (r, c) in enumerate(path):
                wr.writerow([phase, etype, i, r, c, round(float(ctx["x_m"][r, c]), 1),
                             round(float(ctx["y_m"][r, c]), 1), round(float(ctx["altitude"][r, c]), 2),
                             round(float(ctx["hardness"][r, c]), 3), round(float(ctx["dust_smooth"][r, c]), 3),
                             round(d0 + cd[i], 1), round((t0 + ct[i]) / 60, 2), round(ce[i] / 3600, 3)])
            t0 += ct[-1]
            d0 += cd[-1]
    print(f"[EXPORT] {out_csv}")


def plot_mission(ctx: dict, res: dict, out_png="route_eva.png"):
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 3, figsize=(20, 6), dpi=110)
    panels = [
        (ctx["altitude"], "terrain", None, "Topographie (m)"),
        (ctx["hardness"], "YlOrBr_r", (0, 1), "Dureté (proxy relief, 0 = sable, 1 = roche)"),
        (ctx["dust_smooth"], "Reds", (0, 1), "Poussière TES lissée (1 = très poussiéreux)"),
    ]
    start, target = res["start"], res["target"]
    wy, wx = zip(*res["walk_path"])
    theta = np.linspace(0, 2 * np.pi, 200)
    circ_x = target[1] + (R_EXCLUDE_M / DX) * np.cos(theta)
    circ_y = target[0] + (R_EXCLUDE_M / DX) * np.sin(theta)
    overlay = np.ma.masked_where(~res["blocked_rover"], res["blocked_rover"]) if res["mode"] == "rover" else None

    for ax, (data, cmap, lim, title) in zip(axes, panels):
        im = ax.imshow(data, cmap=cmap, origin="upper",
                       vmin=None if lim is None else lim[0], vmax=None if lim is None else lim[1])
        if overlay is not None:
            ax.imshow(overlay, cmap="Reds", alpha=0.30, origin="upper")
        if res["rover_path"] is not None:
            ry, rx = zip(*res["rover_path"])
            ax.plot(rx, ry, color="cyan", linewidth=2.2, label="Trajet rover")
            ax.scatter(res["park"][1], res["park"][0], c="magenta", s=90, edgecolors="black", zorder=5,
                       label="Parking")
        ax.plot(wx, wy, color="yellow", linewidth=2.2, label="Trajet à pied")
        if res["mode"] == "rover":
            ax.plot(circ_x, circ_y, "w--", linewidth=1.2, label="Exclusion rover")
        ax.scatter(start[1], start[0], c="lime", s=80, edgecolors="black", zorder=5, label="Départ")
        ax.scatter(target[1], target[0], c="red", marker="*", s=200, edgecolors="black", zorder=5, label="Cible")
        ax.set_title(title)
        plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    axes[0].legend(loc="lower right", fontsize=8)
    plt.suptitle(f"EVA — mode {res['mode']} | durée EVA {res['eva_s'] / 60:.0f} min | "
                 f"O2 {res['o2_kg']:.2f} kg | Eau {res['h2o_kg']:.2f} kg")
    plt.tight_layout()
    plt.savefig(out_png)
    plt.show()


# ==============================================================================
# EXÉCUTION
# ==============================================================================
if __name__ == "__main__":
    ctx = build_context()
    print(f"Grille chargée : {ctx['altitude'].shape[0]} x {ctx['altitude'].shape[1]} pixels")
    result = plan_mission(ctx, START, TARGET, MODE)
    print_report(result)
    export_route(ctx, result)
    plot_mission(ctx, result)