# Persian font required here

`render/schedule_image.py` needs a TrueType font that covers Persian
script to draw course names, instructors, and day labels on the
schedule image. No font is bundled with this project.

Download one of these (both are free, open-source, and widely used for
Persian UI text) and place the `.ttf` file in this folder:

- **Vazirmatn** — https://github.com/rastikerdar/vazirmatn/releases
  (use `Vazirmatn-Regular.ttf`)
- **Sahel** — https://github.com/rastikerdar/sahel-font/releases

Then point `FONT_PATH` in your `.env` at the file, e.g.:

```
FONT_PATH=render/fonts/Vazirmatn-Regular.ttf
```

If the font is missing, `render_schedule()` raises a clear
`FileNotFoundError` explaining exactly this, instead of silently
drawing boxes for missing glyphs.
