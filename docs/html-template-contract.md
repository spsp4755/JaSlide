# HTML Template Contract

Store an administrator-owned layout string in the template JSON field `config.htmlTemplate`.
JaSlide reads the string as layout metadata only: it does not execute JavaScript, load URLs, render CSS, or copy arbitrary HTML into the exported presentation.

```html
<h1 data-jaslide-slot="title" data-x="0.7" data-y="0.5" data-w="11.9" data-h="0.8" data-font-size="38" data-align="left"></h1>
<p data-jaslide-slot="body" data-x="0.7" data-y="1.6" data-w="11.9" data-h="4.8" data-font-size="20"></p>
```

Each tag represents a text-box slot. Tag names and inner HTML are ignored. The supported slots are `title`, `subtitle`, `body`, and `bullets`. The current renderer applies `title` and `subtitle` to title/content slides, `body` to content slides, and `bullets` to content/bullet-list slides; other specialized slide types retain their built-in layout.

| Attribute | Required | Meaning |
| --- | --- | --- |
| `data-jaslide-slot` | Yes | One supported slot name. Duplicate slots are ignored after the first. |
| `data-x`, `data-y`, `data-w`, `data-h` | Yes | Position and size in inches. The rectangle must fit inside the 13.333 x 7.5 inch slide. |
| `data-font-size` | No | Font size in points, clamped to 8 through 72. |
| `data-align` | No | `left`, `center`, or `right`. |

Invalid coordinates, invalid values, and unknown slots are ignored. Any missing or invalid slot uses JaSlide's built-in PPTX layout, including the template's existing colors and Korean font settings.
