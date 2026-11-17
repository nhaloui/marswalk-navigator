import csv

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter, zoom

# ==============================================================================
# DURETÉ RÉELLE À PARTIR DE LA TEMPÉRATURE JOUR / NUIT (THEMIS)
#   dT = T_jour - T_nuit
#   dT fort   -> le sol chauffe et refroidit vite -> faible inertie -> meuble  (dureté -> 0)
#   dT faible -> forte inertie -> roche / sol induré                          (dureté -> 1)
# Sortie : matrice [0.05, 1.0] de la forme de la grille de travail, comme synthetic_hardness.
# ==============================================================================

THERMAL_SMOOTH_PX = 3      # Lissage (px) : THEMIS fait ~100 m, la grille de travail 24 m
_RESERVED = ("row", "col", "x_m", "y_m", "valid")


def _read_value_grid(path: str, column: str | None, nodata: float | None):
    """Lit un CSV (row, col, ..., valeur) -> matrice 2D avec NaN pour les pixels invalides."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        if "row" not in fields or "col" not in fields:
            raise ValueError(f"{path} : colonnes 'row' et 'col' absentes (trouvé : {fields}).")

        if column is None:
            candidates = [c for c in fields if c not in _RESERVED]
            if len(candidates) != 1:
                raise ValueError(f"{path} : précise la colonne de température parmi {candidates}.")
            column = candidates[0]
        elif column not in fields:
            raise ValueError(f"{path} : colonne '{column}' introuvable (colonnes : {fields}).")

        rows, cols, vals = [], [], []
        for rec in reader:
            rows.append(int(float(rec["row"])))
            cols.append(int(float(rec["col"])))
            try:
                v = float(rec[column])
            except (TypeError, ValueError):
                v = np.nan
            if "valid" in fields and rec.get("valid", "1").strip() in ("0", "0.0", "False", "false"):
                v = np.nan                      # colonne 'valid' : 0 = pixel invalide
            vals.append(v)

    grid = np.full((max(rows) + 1, max(cols) + 1), np.nan, dtype=np.float64)
    grid[rows, cols] = vals
    grid[~np.isfinite(grid)] = np.nan
    if nodata is not None:
        grid[grid == nodata] = np.nan
    return grid, column


def _fill_nearest(a: np.ndarray) -> np.ndarray:
    """Remplace les NaN par la valeur du pixel valide le plus proche."""
    invalid = ~np.isfinite(a)
    if not invalid.any():
        return a
    idx = distance_transform_edt(invalid, return_distances=False, return_indices=True)
    return a[tuple(idx)]


def _to_shape(a: np.ndarray, shape: tuple, name: str) -> np.ndarray:
    """Ramène la grille sur la grille de travail (même emprise supposée) si les tailles diffèrent."""
    if a.shape == shape:
        return a
    print(f"[THERMIQUE] {name} : grille {a.shape} rééchantillonnée vers {shape} "
          f"(on suppose la même emprise carrée).")
    filled = _fill_nearest(a)
    return zoom(filled, (shape[0] / a.shape[0], shape[1] / a.shape[1]), order=1)


def real_hardness(day_csv: str, night_csv: str, target_shape: tuple,
                  day_col: str | None = None, night_col: str | None = None,
                  nodata: float | None = None, smooth_px: float = THERMAL_SMOOTH_PX,
                  dt_soft: float | None = None, dt_hard: float | None = None,
                  normalize: str = "zscore") -> np.ndarray:
    """Dureté [0.05, 1.0] déduite de dT = jour - nuit.

    day_col / night_col : nom de la colonne de température (None = détection automatique
                          si une seule colonne autre que row/col/x_m/y_m/valid existe).
    nodata              : valeur à ignorer en plus des NaN (ex. -32768).
    normalize           : "zscore" (défaut) : chaque image est centrée-réduite avant la différence ;
                          adapté à des mosaïques 8 bits étirées séparément (DN, pas des kelvins) ;
                          dT est alors un indice RELATIF sans unité.
                          "diff" : dT = jour - nuit brut, à n'utiliser que si les deux CSV sont
                          dans la même unité physique (kelvins par ex.).
    dt_soft / dt_hard   : dT (unités de dT : z-scores ou unités des CSV) correspondant à dureté 0 (sol meuble)
                          et 1 (roche). Si None : percentiles 98 % et 2 % de la zone
                          -> dureté RELATIVE à la zone, non comparable d'une zone à l'autre.
    """
    night, ncol = _read_value_grid(night_csv, night_col, nodata)
    day, dcol = _read_value_grid(day_csv, day_col, nodata)
    night = _to_shape(night, target_shape, "nuit")
    day = _to_shape(day, target_shape, "jour")

    if normalize == "zscore":
        day = (day - np.nanmean(day)) / np.nanstd(day)
        night = (night - np.nanmean(night)) / np.nanstd(night)
    elif normalize != "diff":
        raise ValueError("normalize doit valoir 'zscore' ou 'diff'.")

    dT = day - night
    valid = np.isfinite(dT)
    both = valid & np.isfinite(day) & np.isfinite(night)
    corr = float(np.corrcoef(day[both], night[both])[0, 1])
    frac = float(valid.mean())
    if frac < 0.5:
        raise ValueError(f"Seulement {frac:.0%} de pixels valides pour dT : vérifie nodata et les colonnes.")
    med = float(np.median(dT[valid]))
    if normalize == "diff" and med <= 0:
        print(f"[THERMIQUE][ATTENTION] dT médian = {med:.1f} <= 0 : jour et nuit sont peut-être inversés, "
              f"ou les deux mosaïques n'ont pas la même unité / le même étirement.")

    dT = gaussian_filter(_fill_nearest(dT), smooth_px)

    if dt_soft is None or dt_hard is None:
        dt_hard, dt_soft = np.percentile(dT[valid], [2, 98])
    if dt_soft <= dt_hard:
        raise ValueError("dt_soft doit être strictement supérieur à dt_hard.")

    hardness = np.clip((dt_soft - dT) / (dt_soft - dt_hard), 0.0, 1.0)
    hardness = np.clip(hardness, 0.05, 1.0).astype(np.float32)

    print(f"[THERMIQUE] colonnes : nuit='{ncol}', jour='{dcol}' | pixels valides {frac:.0%} | "
          f"corr(jour, nuit) {corr:+.2f} | dT médian {med:.2f} (p2 {dt_hard:.2f}, p98 {dt_soft:.2f}) | "
          f"dureté : min {hardness.min():.2f}, moy {hardness.mean():.2f}, max {hardness.max():.2f}")
    return hardness