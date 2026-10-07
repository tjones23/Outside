import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "About" };

const SOURCES = [
  {
    name: "National Weather Service — alerts",
    href: "https://www.weather.gov/documentation/services-web-api",
    what: "Every active warning, watch, advisory and statement — severe storms, tropical, flood, coastal, heat, winter, wind, fire, marine and more. Checked every minute. Zone-based alerts are outlined from NWS's own watch/warning map service.",
  },
  {
    name: "National Hurricane Center",
    href: "https://www.nhc.noaa.gov/",
    what: "Active storms with their forecast track, cone, coastal watches and warnings and past track, plus the 7-day tropical outlook. Checked every 10 minutes.",
  },
  {
    name: "Storm Prediction Center — storm reports",
    href: "https://www.spc.noaa.gov/climo/reports/",
    what: "Preliminary tornado, wind and hail reports for the last one to five days (SPC days run 12Z to 12Z).",
  },
  {
    name: "Storm Prediction Center — convective outlooks",
    href: "https://www.spc.noaa.gov/products/outlook/",
    what: "Categorical risk for days 1–3 and tornado, wind and hail probabilities for days 1–2. Hatched areas mark conditional intensity.",
  },
  {
    name: "Weather Prediction Center — excessive rainfall outlook",
    href: "https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php",
    what: "The risk of rain heavy enough to cause flash flooding, days 1–5.",
  },
  {
    name: "RainViewer",
    href: "https://www.rainviewer.com/api.html",
    what: "Composite radar for the last hour, animated. The free tier is sharp to zoom 7 and stretched beyond it.",
  },
  {
    name: "NOAA HRRR, via the Iowa Environmental Mesonet",
    href: "https://mesonet.agron.iastate.edu/",
    what: "Future radar: the High-Resolution Rapid Refresh model's simulated reflectivity, hour by hour for the next 18 hours, from the latest hourly run.",
  },
  {
    name: "National Digital Forecast Database",
    href: "https://digital.weather.gov/",
    what: "The National Weather Service's gridded forecast for the next week: temperature, feels-like, gusts, rain, rain chance, cloud cover and snow.",
  },
  {
    name: "Esri Gray Canvas",
    href: "https://www.esri.com/",
    what: "The map and its labels, in Dark Gray or Light Gray to match the theme. Esri, HERE, Garmin, © OpenStreetMap contributors.",
  },
  {
    name: "OpenStreetMap Nominatim",
    href: "https://nominatim.org/",
    what: "Place search when saving a location. Only runs when you press Search.",
  },
];

export default function AboutPage() {
  return (
    <PageBody>
      <PageHeader title="About Outside" subtitle="Severe weather, hazards and forecasts at a glance, from free public data." />

      <div className="space-y-8 text-sm leading-relaxed text-muted">
        <section>
          <h2 className="mb-2 text-base font-semibold text-text">Where the data comes from</h2>
          <ul className="space-y-3">
            {SOURCES.map((s) => (
              <li key={s.name}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-text underline-offset-2 hover:underline"
                >
                  {s.name}
                </a>
                <span className="block">{s.what}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-text">What stays on this device</h2>
          <p>
            There are no accounts. Your saved places, filters and notification choices live in this browser
            only; the server keeps nothing but short-lived copies of the public feeds above, shared by everyone
            who opens it.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-text">Why some features need HTTPS</h2>
          <p>
            Browsers only offer your location and notifications to secure pages. Outside answers on your local
            network over plain HTTP and on your tailnet over HTTPS: everything works on the tailnet address,
            and on the local address the map, lists and place search work but location and notifications
            don&apos;t.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-text">Not an official warning source</h2>
          <p>
            Reports are preliminary and warnings can lag the source by a minute or more. For life-safety
            decisions, rely on NOAA Weather Radio, Wireless Emergency Alerts and local officials.
          </p>
        </section>
      </div>
    </PageBody>
  );
}
