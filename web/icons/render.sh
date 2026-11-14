#!/bin/sh
# Regenerates the PNG icons from the SVGs (needs rsvg-convert, from librsvg).
# The PNGs are committed so building the web reader doesn't need librsvg.
set -e
cd "$(dirname "$0")"
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 512 -h 512 maskable.svg -o maskable-512.png
# Apple draws its own rounded corners, so the touch icon is full-bleed.
rsvg-convert -w 180 -h 180 maskable.svg -o apple-touch-icon.png
