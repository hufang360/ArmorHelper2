# ArmorHelper 2 (Python)

A Python rewrite of [Mirsario's ArmorHelper](https://forums.terraria.org/index.php?threads/armorhelper-sprite-armor-sets-30x-times-faster.68744/),
updated for **Terraria 1.4.4 and newer**.

ArmorHelper turns one small, easy to draw sheet (`ArmorTemplate_v1.png`, 128×80) into every
sprite sheet an armor set needs, instead of you having to draw the same armor 20 times per
layer.

The original tool (2018, .NET Framework / WinForms) produced the old 1.3 layout: `Armor_Head`,
`Armor_Body`, `Armor_Arm` and `Armor_Legs`, each 40×1120 with 20 frames stacked vertically.
Terraria 1.4.4 rewrote player rendering into the *composite* system and merged the body and
the arms into a single **9 × 4 grid**, so the old output is no longer usable. This port keeps
the exact same template and drawing workflow and emits the new layout.

---

## Install

```bash
pip install pillow            # the only runtime dependency for the sheets
pip install wxPython          # only needed for the graphical interface
pip install -e .              # optional, installs `armorhelper` / `armorhelper-gui`
```

Without installing anything you can run it straight from the checkout:

```bash
python3 -m armorhelper --help
```

## Quick start

```bash
# 1. write the drawing template somewhere and edit it in Aseprite / Piskel / ...
python3 -m armorhelper template -o MyArmor.png

# 2. generate the sheets (names: MyArmor_Head.png, MyArmor_Legs.png, MyArmor_Body.png)
python3 -m armorhelper -i MyArmor.png -o out/

# 3. ... or emit ready to drop in vanilla file names
python3 -m armorhelper -i MyArmor.png -o "Terraria/Content/Images" \
    --id-head 189 --id-body 190 --id-legs 130
#   -> Content/Images/Armor_Head_189.png
#      Content/Images/Armor_Legs_130.png
#      Content/Images/Armor/Armor_190.png

# 4. previews and GIFs
python3 -m armorhelper -i MyArmor.png -o out/ --targets all \
    --images "Terraria/Content/Images"
```

## Reverse: get a template *from* a vanilla armor

Sometimes you want the opposite — start from a vanilla armor set and edit it.  Because the
generator is a pure pixel copy plus a nearest neighbour upscale, it can be undone:

```bash
# which head/legs ids belong to body 190?
python3 -m armorhelper sets --search stardust
#   星尘板甲  StardustPlate (body 190, head 189, legs 130)  [name]
python3 -m armorhelper sets --search 星尘      # Chinese search works too

# rebuild the drawing template (head/legs are looked up automatically)
python3 -m armorhelper reverse --images "Terraria/Content/Images" --body 190 -o Stardust.png

# or override, or do every known set at once
python3 -m armorhelper reverse --images "..." --body 190 --head 189 --legs 130 -o out.png
python3 -m armorhelper reverse --images "..." --all -o templates/
```

In the GUI it is the **从原版 ID 还原模板...** button, with a searchable list of every known
set.  The rebuilt template is written into the **Output Folder** (the same folder the sheets go
to); if no output folder has been chosen yet the folder picker opens first and the choice is
remembered.  Each entry reads ``中文名  英文名  (身体 ID)`` — e.g. ``星尘板甲  StardustPlate  (190)`` —
and the search box matches the Chinese name, the English name or any of the ids.

How accurate is it?

| sheet | round trip | notes |
|---|---|---|
| head | 100% | exact |
| legs | 90–100% | the two feet overlap in the texture, so a few pixels of the back foot are not observable |
| body, as rendered in game | 90–97% | the template only has *one* walk-arm pose, so vanilla's four different pose cells collapse into one |

Every vanilla armor texture is an exact 2x nearest neighbour upscale of 1x pixel art (checked
across all 748 armor textures: 0% of the 2x2 blocks are non-uniform), which is why the 128x80
template is enough to describe them.

The set table lives in `armorhelper/data/armor_sets.json`.  Terraria does not store armor sets
as data, so `tools/build_armor_sets.py` derives it from the game sources:

* sets with a bonus come straight out of `ArmorSetBonuses.cs` (authoritative, marked `set-bonus`);
* the rest are matched by the vanilla naming convention (marked `name`/`prefix`);
* the localized names come from the body piece, found by parsing the `bodySlot = n;` assignments
  in `Item.cs` and looking the item up in `Terraria.Localization.Content.zh-Hans.Items.json`
  (202 of 204 sets have a Chinese name).

Regenerate it with:

```bash
python3 tools/build_armor_sets.py /path/to/decompiled/Terraria
```

## Graphical interface

```bash
python3 -m armorhelper gui        # or: armorhelper-gui
```

Built with **wxPython**. The window has the same four groups as ArmorHelper v1 — *Input
Files*, *Output Folder*, *Options* and the big *Export* button — plus a *Details* panel
holding the things the new format needs (glow mask, player skin index, vanilla armor ids and
the path to the game's `Content/Images`).

* Files can be dragged straight onto the window, or added with *Choose...*.
* The input list shows `Never exported` / `Last export was Ns ago`, colour coded green,
  yellow and red, just like the original.
* The *Options* checklist covers every output listed in the table above, including the GIFs.
* Every setting is remembered in `config.json` next to the working directory — options, ids,
  glow, skin, **the input file list, window size/position, column widths, the interface
  language, the folder the dialogs start in and the last export time of each file** — so the
  window reopens exactly where you left it.  Old ArmorHelper v1 configs are still read.
* The game's `Content/Images` folder is auto-detected on first start.
* *视图 → 界面语言* switches between 中文 and English and is remembered.
* Exports run on a worker thread, so the window stays responsive.
* The *反向还原* box rebuilds a template from a vanilla armor id.

## Outputs

| `--targets` name         | File                                        | Size      | Notes |
|--------------------------|---------------------------------------------|-----------|-------|
| `head`                   | `<name>_Head.png` / `Armor_Head_<id>.png`   | 40×1120   | 20 frames, same as 1.3 |
| `legs`                   | `<name>_Legs.png` / `Armor_Legs_<id>.png`   | 40×1120   | 20 frames, same as 1.3 |
| `body`                   | `<name>_Body.png` / `Armor/Armor_<id>.png`  | 360×224   | the 1.4.4+ composite body + arms |
| `legacy`                 | `*_BodyLegacy.png`, `*_ArmsLegacy.png`, …   | 40×1120   | old 1.3 layout, for old mods |
| `full`                   | `<name>_FullArmor.png`                      | 40×1120   | all 20 frames stacked |
| `full-female`            | `<name>_FullArmorFemale.png`                | 40×1120   | |
| `full-player`            | `<name>_FullArmorPlayer.png`                | 40×1120   | needs `--images` |
| `full-player-female`     | `<name>_FullArmorPlayerFemale.png`          | 40×1120   | needs `--images` |
| `gif-full`               | `<name>_FullArmor.gif`                      | 40×56     | animated preview |
| `gif-full-female`        | `<name>_FullArmorFemale.gif`                | 40×56     | |
| `gif-full-player`        | `<name>_FullArmorPlayer.gif`                | 40×56     | needs `--images` |
| `gif-full-player-female` | `<name>_FullArmorPlayerFemale.gif`          | 40×56     | needs `--images` |

`--targets` defaults to `head,legs,body`.  Use `all` for everything, `none` to skip.
Add `--glow` to write the body sheet at 360×448 with a glow mask in rows 4..7.

`--images` must point at an **extracted** (PNG, not `.xnb`) `Terraria/Content/Images`
folder; it is only used to draw the player under the armor for the `*player*` previews.

---

## The template

`armorhelper/data/ArmorTemplate_v1.png` is byte-for-byte the template shipped with
ArmorHelper v1.  It is 128×80 and the regions are:

```
      x:  1        23        44        66      83  100 110
 y  1     +---------+---------+---------+-------+---+---+
          | 5 front arm poses | walk  | back arm      |
 y 19     +---------+---------+---------+-------+---+---+
          |  head   |  body   | female  | legs  |feet   |
          |         |         |         |       |       |
 y 48     +         + jump    + jump    +       +       +
```

* **head** `(1,19,20,28)` — copied to every one of the 20 frames.
* **body** `(23,19,20,28)`, **jump body** `(23,48,20,28)`.
* **female body** `(44,19,20,28)`, **female jump body** `(44,48,20,28)`.
* **arms** — five front arm poses for body frames 0..4, one "walk" arm reused for frames
  6..19 with per-frame offsets, and one back arm.
* **legs** — ten leg pieces plus two feet; the frame tables map them onto the 20 walk frames.

All of the per-frame offsets (`FRONT_ARM_OFFSETS`, `BACK_ARM_OFFSETS`, `BODY_HEAD_OFFSETS`,
`LEG_MAPPING`) are copied unchanged from the original tool — see
`armorhelper/layout.py` and `docs/armorhelper-v1.decompiled.cs`.

---

## Terraria 1.4.4+ texture layout (what changed)

```
Content/Images/Armor_Head_<id>.png    40 x 1120   20 frames, unchanged
Content/Images/Armor_Legs_<id>.png    40 x 1120   20 frames, unchanged
Content/Images/Armor/Armor_<id>.png   360 x 224   9 x 4 grid of 40x56 cells   <-- new
Content/Images/Armor/Armor_<id>.png   360 x 448   ... plus a glow mask in rows 4..7
```

There is no separate arms texture any more: the body, both shoulders, the female variants and
every arm pose live in one texture, which the game samples per cell:

| cell           | content |
|----------------|---------|
| `(0,0)` `(1,0)`| male torso, male torso while jumping (body frame 5) |
| `(0,2)` `(1,2)`| female torso, female torso while jumping |
| `(0,1)` `(1,1)`| male front shoulder / back shoulder |
| `(0,3)` `(1,3)`| female front shoulder / back shoulder |
| `(2..6, 0)`    | front arm for body frames 0..4 |
| `(2..6, 1)`    | front arm for body frames 5..19 (grouped) |
| `(2..6, 2)`    | back arm for body frames 0..4 |
| `(2..6, 3)`    | back arm for body frames 5..19 (grouped) |
| `(7, 0..3)`    | front arm while using an item, one row per "stretch" |
| `(8, 0..3)`    | back arm while using an item |

Rows 4..7 (only present on glowing armors) are the glow mask; the engine samples them with a
`+224 px` offset.

The frame → cell mapping is taken from `PlayerDrawSet.CreateCompositeData` in the Terraria
1.4.5 sources; it is stored in `FRONT_ARM_CELL` / `BACK_ARM_CELL` in `armorhelper/layout.py`.

### How the template maps onto the new grid

* The torso cell receives the template's body art untouched.  The template's body art already
  contains the shoulders and upper arms, so the front/back shoulder cells are intentionally
  left empty — the engine draws the torso before the front arm anyway, which reproduces the
  old look exactly.
* The walking arm cells receive the same arm sprites, at the same offsets ArmorHelper v1 used
  inside its old 20×28 frames.  The engine keeps the arm's position and origin in sync, so the
  rendered result is identical to the 1.3 sheets.  Frames that share a cell (`7..10`, `11..13`,
  `18..19`, …) genuinely have identical offsets in the original tool, so nothing is lost.
* The arm cells for body frames 6..19 use the constant vertical offset `12`: the original added
  `12 + BODY_HEAD_OFFSETS[frame]` to compensate for the body bob, and Terraria now applies that
  bob itself (`Main.OffsetsPlayerHeadgear`), so only the constant part remains.
* Columns 7 and 8 are filled with a copy of the frame 0 arms, so the arms do not disappear
  while swinging a weapon.  Draw your own poses there for a perfect result (the game rotates
  the sprite around the body centre).
* `--glow` copies rows 0..3 into rows 4..7, giving a fully glowing armor that you can then
  erase down to just the parts that should glow.

`tools/inspect_armor.py` renders any 1.4.4+ body texture the way the game does, which is handy
for comparing a generated sheet with a vanilla one:

```bash
python3 tools/inspect_armor.py "Terraria/Content/Images/Armor/Armor_1.png" --frames 0,5
```

---

## Fidelity of the legacy output

`generate_head`, `generate_legs`, `generate_arms` and `generate_body_legacy` are literal ports
of ArmorHelper v1, including its quirks (the clipped back arm, the two ignored template pixels,
the one-pixel "stray" pixel that does not follow the body bob).  `tests/reference.py` contains
an independent transcription of the original C# `GenerateSheets`, and `tests/test_generate.py`
asserts the port produces pixel-identical sheets.  That means a `--targets legacy` run
reproduces the 2018 tool byte for byte.

## Development

```bash
python3 -m pytest tests -q
```

## Credits

* Original tool, template art and workflow: **Mirsario**.
* New composite-layout research: the Terraria 1.4.5 sources and vanilla texture sets.
* This port: Python rewrite of the same tool.

## License

MIT.  The bundled `ArmorTemplate_v1.png` originates from ArmorHelper v1 by Mirsario.
