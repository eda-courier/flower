(() => {
  "use strict";

  const { cities, total } = window.FLOWER_DATA;
  const byId = new Map(cities.map(city => [city.id, city]));
  const format = new Intl.NumberFormat("ru-RU");
  const count = value => format.format(value);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const plural = new Intl.PluralRules("ru-RU");
  const orderWord = value => ({ one: "доставка", few: "доставки", many: "доставок" })[plural.select(value)];
  const storeWord = value => ({ one: "магазин", few: "магазина", many: "магазинов" })[plural.select(value)];
  const bands = [
    { min: 1, color: "#dbc5fb", text: "1–14" },
    { min: 15, color: "#c7a4f5", text: "15–49" },
    { min: 50, color: "#af7dea", text: "50–124" },
    { min: 125, color: "#9455df", text: "125–299" },
    { min: 300, color: "#7832c8", text: "300–599" },
    { min: 600, color: "#5e1ba5", text: "600–1199" },
    { min: 1200, color: "#400e71", text: "1200+" },
  ];
  const colorFor = value => bands.findLast(band => value >= band.min).color;
  const $ = id => document.getElementById(id);
  const citySelect = $("city-select");
  const cityList = $("city-list");
  const zoneList = $("zone-list");
  const tileStatus = $("tile-status");
  let city;
  let zoneLayers = [];
  let activeZone = -1;

  const map = L.map("map", {
    zoomControl: false, scrollWheelZoom: false, minZoom: 8, maxZoom: 17,
    zoomSnap: 0.5, zoomAnimation: !reduceMotion.matches, fadeAnimation: !reduceMotion.matches,
    attributionControl: false,
  });
  L.control.attribution({ prefix: false }).addTo(map);
  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(map);
  L.control.zoom({ position: "topleft", zoomInTitle: "Приблизить карту", zoomOutTitle: "Отдалить карту" }).addTo(map);
  L.control.scale({ imperial: false, maxWidth: 100 }).addTo(map);
  const zones = L.layerGroup().addTo(map);
  const labels = L.layerGroup().addTo(map);
  const popup = L.popup({ maxWidth: 250, closeButton: true });

  tiles.on("load", () => {
    const visibleTiles = document.querySelectorAll(".leaflet-tile-loaded");
    tileStatus.hidden = [...visibleTiles].some(tile => tile.naturalWidth > 0);
  });

  $("total-orders").textContent = count(total);
  $("total-cities").textContent = count(cities.length);
  $("legend-scale").innerHTML = bands.map(({ min, color, text }) =>
    `<span class="legend-stop"><i style="background:${color}"></i>` +
    `<span class="legend-range">${text}</span><span class="legend-min">${min}+</span></span>`).join("");

  const rankLinks = new Map();
  for (const [index, entry] of cities.entries()) {
    citySelect.add(new Option(entry.name, entry.id));
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "city-link";
    button.innerHTML = `<span class="rank-no">${index + 1}</span><span>${entry.name}</span>` +
      `<span class="rank-count">${count(entry.orders)}</span>` +
      `<span class="rank-bar" aria-hidden="true"><i style="--share:${entry.orders / cities[0].orders * 100}%"></i></span>`;
    button.setAttribute("aria-label", `${index + 1}. ${entry.name}, ${count(entry.orders)} ${orderWord(entry.orders)}`);
    button.addEventListener("click", () => {
      chooseCity(entry.id);
      if (matchMedia("(max-width: 850px)").matches) {
        citySelect.focus({ preventScroll: true });
        $("map").closest(".map-panel").scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "instant" : "smooth" });
      }
    });
    rankLinks.set(entry.id, button);
    row.append(button);
    cityList.append(row);
  }

  function hexagon(lat, lon) {
    return Array.from({ length: 6 }, (_, index) => {
      const angle = (30 + 60 * index) * Math.PI / 180;
      return [lat + city.radiusLat * Math.sin(angle), lon + city.radiusLon * Math.cos(angle)];
    });
  }

  function applyZoneStyle(index) {
    const selected = index === activeZone;
    zoneLayers[index].setStyle({
      stroke: true, color: selected ? "#3c105f" : "#fff",
      weight: selected ? 2.75 : 1, opacity: selected ? 1 : .74,
      fillOpacity: selected ? .93 : .74,
    });
  }

  function clearZone() {
    if (activeZone < 0) return;
    const previous = activeZone;
    activeZone = -1;
    applyZoneStyle(previous);
    zoneList.children[previous]?.setAttribute("aria-pressed", "false");
  }

  function showZone(index, center) {
    const [lat, lon, orders, stores] = city.zones[index];
    const point = [lat, lon];
    if (map.hasLayer(popup)) map.closePopup(popup);
    if (center) map.setView(point, Math.max(map.getZoom(), 12), { animate: false });
    activeZone = index;
    applyZoneStyle(index);
    zoneLayers[index].bringToFront();
    zoneList.children[index]?.setAttribute("aria-pressed", "true");
    popup.setLatLng(point).setContent(
      `<span class="popup-title">${index < 3 ? `Зона №${index + 1} по доставкам` : "Доставки в зоне"}</span>` +
      `<strong class="popup-count">${count(orders)} ${orderWord(orders)}</strong>` +
      `<span>${count(stores)} ${storeWord(stores)}</span>`,
    ).openOn(map);
    popup.getElement()?.querySelector(".leaflet-popup-close-button")?.setAttribute("aria-label", "Закрыть зону");
  }

  function refreshLabels() {
    labels.clearLayers();
    if (!city) return;
    const used = [];
    for (const [lat, lon, orders] of city.zones.slice(0, 3)) {
      const pos = map.latLngToContainerPoint([lat, lon]);
      if (used.some(point => Math.abs(point.x - pos.x) < 57 && Math.abs(point.y - pos.y) < 27)) continue;
      const icon = L.divIcon({ html: count(orders), className: "zone-label", iconSize: null,
        iconAnchor: [orders >= 1000 ? 24 : 17, 12] });
      L.marker([lat, lon], { icon, interactive: false, keyboard: false }).addTo(labels);
      used.push(pos);
    }
  }

  function fitCity(all = false) {
    const bounds = L.latLngBounds([]);
    let sum = 0;
    for (const [index, [lat, lon, orders]] of city.zones.entries()) {
      bounds.extend([lat - city.radiusLat, lon - city.radiusLon]);
      bounds.extend([lat + city.radiusLat, lon + city.radiusLon]);
      sum += orders;
      if (!all && sum / city.orders >= .93 && index >= 4) break;
    }
    map.fitBounds(bounds, {
      paddingTopLeft: [24, 30], paddingBottomRight: [20, 85], maxZoom: 13, animate: false,
    });
  }

  function chooseCity(id, updateHash = true) {
    const next = byId.get(id) ?? cities[0];
    if (city === next) return;
    map.closePopup();
    zones.clearLayers();
    labels.clearLayers();
    zoneLayers = [];
    activeZone = -1;
    city = next;

    citySelect.value = city.id;
    for (const [key, button] of rankLinks) button.setAttribute("aria-current", String(key === city.id));
    $("map").setAttribute("aria-label", `Карта доставок цветов. ${city.name}`);
    $("city-stats").innerHTML = `<span class="metric"><strong>${count(city.orders)}</strong><span>${orderWord(city.orders)}</span></span>` +
      `<span class="metric"><strong>${count(city.stores)}</strong><span>${storeWord(city.stores)}</span></span>`;

    zoneList.replaceChildren();
    city.zones.slice(0, 3).forEach(([, , orders], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zone-button";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", `Зона №${index + 1}. ${count(orders)} ${orderWord(orders)}. Показать на карте`);
      button.innerHTML = `<span>Зона №${index + 1}</span><strong>${count(orders)}</strong>`;
      button.addEventListener("click", () => showZone(index, true));
      zoneList.append(button);
    });

    for (const [index, [lat, lon, orders]] of city.zones.entries()) {
      const polygon = L.polygon(hexagon(lat, lon), {
        fillColor: colorFor(orders), bubblingMouseEvents: false,
      }).addTo(zones);
      zoneLayers.push(polygon);
      applyZoneStyle(index);
      polygon.on("click", () => showZone(index, false));
      polygon.on("mouseover", () => polygon.setStyle({ fillOpacity: .94 }));
      polygon.on("mouseout", () => applyZoneStyle(index));
    }

    fitCity();
    refreshLabels();
    if (updateHash) history.replaceState(null, "", `#${city.id}`);
  }

  map.on("zoomend", refreshLabels);
  map.on("popupclose", clearZone);
  citySelect.addEventListener("change", () => chooseCity(citySelect.value));
  $("reset-map").addEventListener("click", () => {
    map.closePopup();
    fitCity(true);
  });
  window.addEventListener("hashchange", () => chooseCity(location.hash.slice(1), false));
  chooseCity(location.hash.slice(1), false);
})();
