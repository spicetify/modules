# Spicetify Splash

A startup screen that covers Spotify while the client, your modules, and your theme load. It follows your theme's colors and fades out once everything is ready.

## Styling it

Add CSS in **Spicetify Settings → Spicetify Splash → Custom CSS**, or ship it in your theme. Use **Preview splash** to see your changes without restarting.

Theme stylesheets load after the splash first appears. To avoid a jump, the splash saves every rule that mentions `spicetify-splash`, the keyframes those rules animate with, and the values of the custom properties they read, after each successful startup. From the next startup on, they apply from the first frame.

The built-in styles live in the `spicetify-splash` cascade layer, so any rule you write wins without `!important`. Custom CSS from settings is applied after your theme, so it wins over theme rules of the same specificity.

### Variables

Set these on `.spicetify-splash`. Setting them on `:root` also works, unless your theme sets the same variable on `.spicetify-splash`.

| Variable                   | Default                          | Controls                                            |
| -------------------------- | -------------------------------- | --------------------------------------------------- |
| `--splash-background`      | `--spice-main`, then `#121212`   | Surface color                                       |
| `--splash-foreground`      | `--spice-text`, then `#ffffff`   | Caption and progress track                          |
| `--splash-accent`          | `--spice-button`, then `#f26b3a` | Progress bar and glow                               |
| `--splash-glow`            | `--splash-accent`                | Glow behind the logo                                |
| `--splash-glow-secondary`  | `--splash-logo-end`              | Wide ambient wash                                   |
| `--splash-glow-opacity`    | `0.32`                           | Strength of both glows                              |
| `--splash-logo-fill`       | the flame gradient               | Any paint, e.g. `var(--spice-button)` for one color |
| `--splash-logo-start`      | `#f68c28`                        | Top of the flame gradient                           |
| `--splash-logo-end`        | `#e8473c`                        | Bottom of the flame gradient                        |
| `--splash-logo-size`       | `96px`                           | Logo width                                          |
| `--splash-image-size`      | `160px`                          | Width of a custom image                             |
| `--splash-bar-width`       | `64px`                           | Progress bar width                                  |
| `--splash-bar-height`      | `3px`                            | Progress bar height                                 |
| `--splash-bar-color`       | `--splash-accent`                | Progress bar fill                                   |
| `--splash-caption`         | `""`                             | Caption text, as a CSS string                       |
| `--splash-font`            | inherited                        | Caption font                                        |
| `--splash-motion-duration` | `3.2s`                           | Flame sway period; the glow drift scales from it    |
| `--splash-exit-duration`   | `450ms`                          | Fade-out length                                     |

### Structure

```html
<dialog class="spicetify-splash" data-stage="boot | loading | leaving" data-image="default | custom">
	<div class="spicetify-splash__surface">
		<div class="spicetify-splash__backdrop"></div>
		<!-- glows, on ::before and ::after -->
		<div class="spicetify-splash__content">
			<div class="spicetify-splash__logo"><svg class="spicetify-splash__mark">…</svg></div>
			<div class="spicetify-splash__bar"></div>
			<!-- indicator on ::after -->
			<p class="spicetify-splash__caption"></p>
			<!-- text on ::after -->
		</div>
	</div>
</dialog>
```

`data-stage` is `boot` until Spotify's interface exists, `loading` while modules load, and `leaving` during the fade. Style the inner elements; the `<dialog>` itself is pinned full screen.

### Examples

A single-color logo with a caption that changes per stage:

```css
.spicetify-splash {
	--splash-logo-fill: var(--spice-button);
	--splash-glow-opacity: 0.2;
}
.spicetify-splash[data-stage="boot"] {
	--splash-caption: "starting Spotify";
}
.spicetify-splash[data-stage="loading"] {
	--splash-caption: "loading modules";
}
```

A corner layout with no glow:

```css
.spicetify-splash__surface {
	place-items: end start;
	padding: 48px;
}
.spicetify-splash__content {
	flex-direction: row;
	gap: 20px;
}
.spicetify-splash__bar {
	margin: 0;
}
.spicetify-splash__backdrop {
	display: none;
}
.spicetify-splash {
	--splash-logo-size: 48px;
}
```

Reduced motion turns off every splash animation, including custom ones.
