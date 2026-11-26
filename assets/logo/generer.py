"""Génère les icônes de Vitrum à partir d'une seule description du logo :
icône Windows (.ico), icône macOS (.icns), images PNG et SVG.

Utilisation (Python 3 et Pillow) :
    python assets/logo/generer.py            fichiers de src-tauri/icons
    python assets/logo/generer.py --apercu   planche de contrôle (apercu.png)

Le logo (variante B2, choix de Leeva le 2026-11-26), dans le style de
Polyptyque et Rotulus : une feuille blanche au coin coupé, marquée d'un dièse
de Markdown en creux, sur un carré arrondi en dégradé bleu glacier.
En 32 pixels et moins, la feuille disparaît : le dièse seul, en blanc,
reste lisible.

Windows et Linux : le carré remplit toute l'image, comme Polyptyque et
Rotulus. macOS : marge autour du carré (grille des icônes du Dock), pour
que l'icône ait la même taille que les autres applications.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ICI = Path(__file__).resolve().parent
ICONES = ICI.parent.parent / "src-tauri" / "icons"
SURECHANTILLONNAGE = 8

DEGRADE_HAUT = (132, 214, 255)
DEGRADE_BAS = (46, 134, 230)
# Dièse en creux : la couleur du fond aux deux tiers du dégradé.
CREUX = tuple(round(a + (b - a) * 0.62) for a, b in zip(DEGRADE_HAUT, DEGRADE_BAS))
RAYON = 0.22  # arrondi du carré, en part du côté
MARGE_MAC = 100 / 1024  # carré de 824 sur une grille de 1024
SEUIL_SIMPLE = 32  # en dessous ou égal : dièse seul

# Géométrie, sur une grille de 1024.
FEUILLE = (292, 200, 732, 830)  # x0, y0, x1, y1
PLI = 150
RAYON_FEUILLE = 56


def diese(centre_y=560, echelle=1.0, epaisseur=50):
    """Quatre traits du dièse : deux obliques, deux horizontaux."""
    cx, cy, k = 512, centre_y, echelle
    return epaisseur * k, [
        ((cx - 42 * k, cy - 125 * k), (cx - 66 * k, cy + 125 * k)),
        ((cx + 72 * k, cy - 125 * k), (cx + 48 * k, cy + 125 * k)),
        ((cx - 118 * k, cy - 45 * k), (cx + 128 * k, cy - 45 * k)),
        ((cx - 128 * k, cy + 45 * k), (cx + 118 * k, cy + 45 * k)),
    ]


DIESE_PLEIN = diese()
DIESE_SEUL = diese(centre_y=512, echelle=1.55, epaisseur=62)


def icone(taille, marge=0.0, simple=None):
    if simple is None:
        simple = taille <= SEUIL_SIMPLE
    s = SURECHANTILLONNAGE
    g = taille * s
    m = round(g * marge)
    cote = g - 2 * m
    u = cote / 1024

    def p(x, y):
        return (m + x * u, m + y * u)

    # Fond : dégradé vertical dans un carré arrondi.
    degrade = Image.new("RGBA", (cote, cote))
    trace = ImageDraw.Draw(degrade)
    for y in range(cote):
        t = y / cote
        couleur = tuple(round(a + (b - a) * t) for a, b in zip(DEGRADE_HAUT, DEGRADE_BAS))
        trace.line([(0, y), (cote, y)], fill=couleur + (255,))
    masque = Image.new("L", (cote, cote), 0)
    ImageDraw.Draw(masque).rounded_rectangle([0, 0, cote - 1, cote - 1], radius=round(cote * RAYON), fill=255)
    image = Image.new("RGBA", (g, g), (0, 0, 0, 0))
    image.paste(degrade, (m, m), masque)

    calque = Image.new("RGBA", (g, g), (0, 0, 0, 0))
    if simple:
        epaisseur, traits, couleur = *DIESE_SEUL, (255, 255, 255, 255)
    else:
        # Feuille blanche, coin supérieur droit coupé.
        x0, y0, x1, y1 = FEUILLE
        page = Image.new("L", (g, g), 0)
        dessin = ImageDraw.Draw(page)
        dessin.rounded_rectangle([*p(x0, y0), *p(x1, y1)], radius=RAYON_FEUILLE * u, fill=255)
        dessin.polygon([p(x1 - PLI, y0 - 2), p(x1 + 2, y0 - 2), p(x1 + 2, y0 + PLI)], fill=0)
        calque.paste(Image.new("RGBA", (g, g), (255, 255, 255, 255)), (0, 0), page)
        epaisseur, traits, couleur = *DIESE_PLEIN, CREUX + (255,)

    dessin = ImageDraw.Draw(calque)
    r = epaisseur / 2 * u
    for a, b in traits:
        dessin.line([p(*a), p(*b)], fill=couleur, width=round(epaisseur * u))
        for x, y in (p(*a), p(*b)):
            dessin.ellipse([x - r, y - r, x + r, y + r], fill=couleur)

    image = Image.alpha_composite(image, calque)
    return image.resize((taille, taille), Image.LANCZOS)


def hexa(c):
    return "#%02x%02x%02x" % c


def svg():
    """Même logo en vectoriel (grande taille, sans marge)."""
    x0, y0, x1, y1 = FEUILLE
    r = RAYON_FEUILLE
    feuille = (
        f"M{x0 + r} {y0}H{x1 - PLI}L{x1} {y0 + PLI}V{y1 - r}"
        f"A{r} {r} 0 0 1 {x1 - r} {y1}H{x0 + r}A{r} {r} 0 0 1 {x0} {y1 - r}"
        f"V{y0 + r}A{r} {r} 0 0 1 {x0 + r} {y0}Z"
    )
    epaisseur, traits = DIESE_PLEIN
    lignes = "\n    ".join(f'<path d="M{a[0]:g} {a[1]:g}L{b[0]:g} {b[1]:g}"/>' for a, b in traits)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="fond" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{hexa(DEGRADE_HAUT)}"/>
      <stop offset="1" stop-color="{hexa(DEGRADE_BAS)}"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="{round(1024 * RAYON)}" fill="url(#fond)"/>
  <path d="{feuille}" fill="#ffffff"/>
  <g stroke="{hexa(CREUX)}" stroke-width="{epaisseur:g}" stroke-linecap="round" fill="none">
    {lignes}
  </g>
</svg>
"""


def fichiers():
    # Windows : .ico sans marge.
    tailles = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    images = [icone(t) for t in tailles]
    images[-1].save(ICONES / "icon.ico", sizes=[(t, t) for t in tailles], append_images=images[:-1])
    # Linux et fenêtre : PNG sans marge.
    for nom, t in (("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)):
        icone(t).save(ICONES / nom)
    # macOS : .icns avec marge. L'entrée de 32 pixels (16 points Retina) reçoit le dièse seul.
    mac = [icone(t, marge=MARGE_MAC) for t in (32, 64, 128, 256, 512)]
    icone(1024, marge=MARGE_MAC).save(ICONES / "icon.icns", append_images=mac)
    (ICONES / "app-icon.svg").write_text(svg(), encoding="utf-8", newline="\n")
    icone(512).save(ICI / "vitrum-512.png")
    print("icônes générées dans", ICONES)


def apercu():
    """Planche de contrôle : Windows en haut, macOS en bas."""
    tailles = [256, 128, 64, 48, 40, 32, 24, 16]
    largeur = sum(tailles) + 30 * (len(tailles) + 1)
    planche = Image.new("RGBA", (largeur, 2 * 256 + 90), (245, 245, 248, 255))
    for rang, marge in enumerate((0.0, MARGE_MAC)):
        x = 30
        for t in tailles:
            planche.alpha_composite(icone(t, marge=marge), (x, 30 + rang * 286 + (256 - t) // 2))
            x += t + 30
    planche.save(ICI / "apercu.png")


if __name__ == "__main__":
    apercu() if "--apercu" in sys.argv else fichiers()
