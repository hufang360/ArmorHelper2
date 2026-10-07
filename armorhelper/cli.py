"""Command line interface."""

from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import replace
from pathlib import Path

from . import __version__
from .export import DEFAULT_TARGETS, TARGETS, ExportSettings, export_template
from .layout import ArmorTemplateError, load_template, template_bytes
from .reverse import reverse_from_images
from .vanilla import all_sets, describe, find_set, sanitize_filename, search_sets, source_info

__all__ = ["main", "build_parser"]

USAGE_EXAMPLES = """\
examples:
  # Generate the three sheets with the familiar "name_Head/Body/Legs" names
  armorhelper -i MyArmor.png -o out/

  # Emit ready-to-drop-in vanilla files (Armor_Head_189.png, Armor/Armor_190.png, ...)
  armorhelper -i MyArmor.png -o "Terraria/Content/Images" \\
      --id-head 189 --id-body 190 --id-legs 130

  # Everything, including the previews and GIFs
  armorhelper -i MyArmor.png -o out/ --targets all --images "Terraria/Content/Images"

  # Write the drawing template next to you
  armorhelper template -o ArmorTemplate_v1.png

  # Reverse a vanilla armor back into a drawing template (1.4.4+ textures)
  armorhelper reverse --images "Terraria/Content/Images" --body 190 -o Stardust.png

  # ... or reverse every known vanilla armor set at once
  armorhelper reverse --images "Terraria/Content/Images" --all -o templates/

  # Look up which head/legs ids belong to a body armor
  armorhelper sets --search stardust

  # Browser interface (local only, no extra dependency)
  armorhelper web --open
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="armorhelper",
        description="Convert simple armor sheets into Terraria armor sprites.",
        epilog=USAGE_EXAMPLES,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", action="version", version=f"ArmorHelper {__version__}")
    sub = parser.add_subparsers(dest="command")

    export = sub.add_parser("export", help="convert template images into Terraria sheets")
    _add_export_arguments(export)

    template_parser = sub.add_parser("template", help="write the bundled drawing template")
    template_parser.add_argument(
        "-o", "--output", default="ArmorTemplate_v1.png", help="where to write the PNG"
    )
    template_parser.add_argument("-f", "--force", action="store_true", help="overwrite an existing file")

    sub.add_parser("targets", help="list the output names accepted by --targets")

    reverse = sub.add_parser(
        "reverse",
        help="rebuild a 128x80 drawing template from Terraria's armor textures",
    )
    _add_reverse_arguments(reverse)

    sets = sub.add_parser("sets", help="list or search the known vanilla armor sets")
    sets.add_argument("-s", "--search", default="", help="filter by name or id")

    gui_parser = sub.add_parser("gui", help="launch the graphical interface")
    gui_parser.add_argument(
        "--lang",
        choices=("zh_CN", "en"),
        default=None,
        help="interface language (default: zh_CN, or ARMORHELPER_LANG)",
    )

    web_parser = sub.add_parser("web", help="serve the browser interface")
    web_parser.add_argument("--host", default="127.0.0.1", help="bind address (default: 127.0.0.1)")
    web_parser.add_argument("--port", type=int, default=8765, help="port (default: 8765, 0 = random)")
    web_parser.add_argument("-o", "--open", action="store_true", help="open the browser")
    web_parser.add_argument(
        "--config", default=None, metavar="PATH", help="settings file (default: web-config.json)"
    )

    return parser


def _add_export_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "-i",
        "--input",
        dest="inputs",
        nargs="+",
        required=True,
        metavar="PNG",
        help="one or more 128x80 template images",
    )
    parser.add_argument(
        "-o", "--output", required=True, metavar="DIR", help="folder to write the sheets into"
    )
    parser.add_argument(
        "-t",
        "--targets",
        default="default",
        metavar="LIST",
        help=(
            "comma separated list of outputs (default: "
            + ",".join(DEFAULT_TARGETS)
            + ").  Use 'all' for everything, 'none' to only write the sheets."
        ),
    )
    parser.add_argument("--id-head", type=int, metavar="N", help="vanilla head armor id")
    parser.add_argument("--id-body", type=int, metavar="N", help="vanilla body armor id")
    parser.add_argument("--id-legs", type=int, metavar="N", help="vanilla legs armor id")
    parser.add_argument("--id", type=int, metavar="N", dest="id_all", help="sets all three ids at once")
    parser.add_argument(
        "--body-subdir",
        default="Armor",
        help="sub folder used for the body sheet when ids are given (default: Armor)",
    )
    parser.add_argument(
        "--glow",
        action="store_true",
        help="also write a glow mask (rows 4..7 of the body sheet, 360x448)",
    )
    parser.add_argument(
        "--images",
        metavar="DIR",
        help="Terraria Content/Images folder, needed for the 'Full Armor + Player' outputs",
    )
    parser.add_argument("--skin", type=int, default=0, help="player skin index for the previews")
    parser.add_argument("-q", "--quiet", action="store_true", help="only print errors")
    parser.add_argument("-v", "--verbose", action="store_true", help="print every file written")


def _add_reverse_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--images",
        required=True,
        metavar="DIR",
        help="Terraria Content/Images folder holding the extracted PNG textures",
    )
    parser.add_argument("--body", type=int, metavar="N", help="body armor id")
    parser.add_argument("--head", type=int, metavar="N", help="head armor id (looked up when omitted)")
    parser.add_argument("--legs", type=int, metavar="N", help="legs armor id (looked up when omitted)")
    parser.add_argument("--name", metavar="TEXT", help="find the set by name instead of by id")
    parser.add_argument(
        "--all",
        action="store_true",
        help="rebuild a template for every known vanilla set, into <output>/ArmorTemplate",
    )
    parser.add_argument(
        "--subdir",
        default="ArmorTemplate",
        metavar="NAME",
        help="sub folder used by --all (default: ArmorTemplate, use '' to write directly into -o)",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=True,
        metavar="PATH",
        help="output PNG, or an output folder when --all is used",
    )
    parser.add_argument("-f", "--force", action="store_true", help="overwrite existing files")
    parser.add_argument("-q", "--quiet", action="store_true", help="only print errors")


def _run_reverse(args: argparse.Namespace) -> int:
    images = Path(args.images)
    if not images.is_dir():
        print(f"error: {images} is not a folder", file=sys.stderr)
        return 1

    if args.all:
        jobs = [item for item in all_sets() if item.complete]
    else:
        if args.body is None and not args.name:
            print("error: pass --body N (or --name TEXT, or --all)", file=sys.stderr)
            return 1
        wanted = find_set(body=args.body, name=args.name)
        if wanted is None:
            if args.body is None:
                print(f"error: no known armor set named {args.name!r}", file=sys.stderr)
            else:
                print(f"error: no known armor set with body id {args.body}", file=sys.stderr)
            return 1
        jobs = [
            replace(
                wanted,
                head=args.head if args.head is not None else wanted.head,
                legs=args.legs if args.legs is not None else wanted.legs,
            )
        ]

    output = Path(args.output)
    as_folder = args.all or output.suffix.lower() != ".png"
    if args.all and args.subdir:
        output = output / args.subdir
    if as_folder:
        output.mkdir(parents=True, exist_ok=True)

    failures = 0
    for job in jobs:
        label = sanitize_filename(job.zh_display or job.name)
        target = output / f"ArmorTemplate_{label}_{job.body}.png" if as_folder else output
        if target.exists() and not args.force:
            print(f"skip {target} (exists, pass --force)", file=sys.stderr)
            failures += 1
            continue
        try:
            result = reverse_from_images(
                images, body=job.body, head=job.head, legs=job.legs, set_name=job.name
            )
        except Exception as error:  # noqa: BLE001 - report and continue
            print(f"error: {job.name}: {error}", file=sys.stderr)
            failures += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        result.template.save(target, "PNG")
        if not args.quiet:
            print(f"{target}  <-  {describe(job)}")
            for warning in result.warnings:
                print(f"    note: {warning}")
    return 1 if failures else 0


def _run_sets(args: argparse.Namespace) -> int:
    info = source_info()
    print(f"armor set table: {info['count']} entries  ({info['source']})")
    for item in search_sets(args.search):
        print("  " + describe(item))
    return 0


def _resolve_targets(raw: str) -> tuple[str, ...]:
    if raw in ("all", "*"):
        return TARGETS
    if raw in ("none", ""):
        return ()
    if raw == "default":
        return DEFAULT_TARGETS
    result = []
    for name in (piece.strip() for piece in raw.split(",")):
        if not name:
            continue
        if name not in TARGETS:
            raise SystemExit(
                f"Unknown target {name!r}.  Known targets: {', '.join(TARGETS)}, all, none"
            )
        result.append(name)
    return tuple(result)


def _run_export(args: argparse.Namespace) -> int:
    ids = {
        "id_head": args.id_head,
        "id_body": args.id_body,
        "id_legs": args.id_legs,
    }
    if args.id_all is not None:
        for key in ids:
            if ids[key] is None:
                ids[key] = args.id_all

    settings = ExportSettings(
        output_dir=Path(args.output),
        targets=_resolve_targets(args.targets),
        body_subdir=args.body_subdir,
        glow_rows=4 if args.glow else 0,
        images_dir=Path(args.images) if args.images else None,
        skin=args.skin,
        **ids,
    )

    failed = 0
    for raw_input in args.inputs:
        path = Path(raw_input)
        try:
            template = load_template(path)
        except ArmorTemplateError as error:
            print(f"error: {path}: {error}", file=sys.stderr)
            failed += 1
            continue
        try:
            written = export_template(template, path.stem, settings)
        except Exception as error:  # noqa: BLE001 - report and keep going
            print(f"error: {path}: {error}", file=sys.stderr)
            failed += 1
            continue
        if not written:
            print(f"warning: {path}: nothing was written", file=sys.stderr)

    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)

    if not argv:
        argv = ["gui"]
    elif argv[0] not in {"export", "reverse", "sets", "template", "targets", "gui", "web", "-h", "--help", "--version"}:
        # Allow ``armorhelper -i foo.png -o out`` without the sub command.
        argv.insert(0, "export")

    parser = build_parser()
    args = parser.parse_args(argv)

    logger = logging.getLogger("armorhelper")
    logger.handlers.clear()
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    logger.propagate = False
    if getattr(args, "quiet", False):
        logger.setLevel(logging.ERROR)
    elif getattr(args, "verbose", False):
        logger.setLevel(logging.DEBUG)
    else:
        logger.setLevel(logging.INFO)

    command = args.command
    if command == "export":
        return _run_export(args)
    if command == "reverse":
        return _run_reverse(args)
    if command == "sets":
        return _run_sets(args)
    if command == "template":
        target = Path(args.output)
        if target.exists() and not args.force:
            print(f"error: {target} already exists (pass --force to overwrite)", file=sys.stderr)
            return 1
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(template_bytes())
        print(f"wrote {target}")
        return 0
    if command == "targets":
        for name in TARGETS:
            print(name)
        return 0
    if command == "gui":
        from . import i18n

        if getattr(args, "lang", None):
            i18n.set_language(args.lang)
        from .gui import run

        return run()
    if command == "web":
        from . import i18n
        from .web import serve
        from .web.api import Api

        if getattr(args, "lang", None):
            i18n.set_language(args.lang)
        serve(
            args.host,
            args.port,
            open_browser=args.open,
            api=Api(config_path=args.config) if args.config else Api(),
        )
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
