// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
import { $ } from "./format";

export function renderAbout(): void {
  $("about").innerHTML = `<div class="about">
  <div class="rc-card glass"><h3>The question</h3>
    <p>At this point on the Moon, on this date, can a solar-powered lander see the Sun and Earth above its <b>real</b> terrain horizon — for how long — and how does a schedule slip or a nearby site change the answer? Near the south pole the Sun never climbs more than a few degrees, so a ridge one degree high is the difference between power and night.</p></div>
  <div class="rc-card glass"><h3>Method</h3>
    <ol>
      <li><b>Sun & Earth</b> — one hourly NASA/JPL Horizons table (Aug 2023 – Jan 2029) of the apparent sub-solar and sub-Earth points on the Moon. Azimuth/elevation for any lunar point by vector maths in the local east/north/up frame (1,737.4 km sphere), checked against Horizons' own topocentric output (Reality Check §1).</li>
      <li><b>Terrain skyline</b> — 720 great-circle rays per site through NASA Goddard LOLA DEMs (20 m near field, 80 m to 150 km, 240 m to 260 km), exact elevation angle with curvature, 2 m eye height. Custom points south of 80°S use a 400 m grid computed in the browser.</li>
      <li><b>Visibility</b> — Sun: share of its 0.27°-radius disc above the skyline; “sunlit” when at least half shows. Earth: centre above the skyline (line of sight only). Smooth Moon: the same geometry against a perfect sphere.</li>
      <li><b>Metrics</b> — over an explicit window (14 or 30 days, 30-minute steps): % sunlit, % Earth in view, % both, longest night, longest Earth blackout, next sunset/Earthset. Runs touching the window edge are marked “≥”.</li>
    </ol></div>
  <div class="rc-card glass"><h3>Data sources</h3><ul>
    <li>NASA/JPL Horizons API — <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noopener">ssd.jpl.nasa.gov/horizons</a></li>
    <li>NASA Goddard PGDA — LOLA south-pole DEMs, Barker et al. 2023 (LDEM_80S_20MPP_ADJ, LDEM_80S_80MPP_ADJ, LDEM_60S_240MPP_ADJ) — <a href="https://pgda.gsfc.nasa.gov/products/90" target="_blank" rel="noopener">pgda.gsfc.nasa.gov/products/90</a></li>
    <li>NASA Goddard PGDA — Lunar Polar Illumination, Mazarico et al. (AVGVISIB maps, used only for validation) — <a href="https://pgda.gsfc.nasa.gov/products/69" target="_blank" rel="noopener">pgda.gsfc.nasa.gov/products/69</a></li>
    <li>NASA Moon Trek — LRO WAC global mosaic tiles for the 3D globe — <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener">trek.nasa.gov/moon</a></li>
    <li>Cesium Moon Terrain (Cesium ion asset 2684829), when a token is supplied — <a href="https://cesium.com/platform/cesium-ion/content/cesium-moon/" target="_blank" rel="noopener">cesium.com</a></li>
    <li>Site coordinates — LROC (IM-1, IM-2), IAU/WGPSN (Statio Shiv Shakti); Artemis regions named per NASA (Oct 2024), not given as points.</li>
    <li>Astronaut model — NASA 3D Resources (free, no copyright).</li>
  </ul></div>
  <div class="rc-card glass"><h3>Limits, plainly</h3><p>Geometry only. Sunlight is not power (panel pointing, dust, temperature and batteries are not modelled). Earth in view is not a radio link (antennas, ground stations and link budgets are not modelled). DEM cells are 20–400 m, so boulders and small craters are invisible. The 3D scene's lighting is driven by the same Horizons Sun direction, but its terrain mesh is a rendering, not the science DEM. Ephemeris covers Aug 2023 – Dec 2028.</p></div>
  <div class="rc-card glass"><h3>Use of AI</h3><p>Built during NASA Space Apps 2026 (Nov 14–15) by team Beyond Million with heavy AI assistance: Claude Code (Anthropic) wrote most of the code and data-processing scripts under the owner's direction; AI chat tools were also used for brainstorming and planning. All data are from the NASA sources above; no AI-generated images, video or audio are used. Details: docs/AI_DISCLOSURE.md in the repository.</p></div>
</div>`;
}
