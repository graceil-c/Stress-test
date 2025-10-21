(function () {
    'use strict';

    // Shared utilities
    const $ = (selector, scope = document) => scope.querySelector(selector);
    const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

    // Set current year in footer
    const yearEl = $('#year');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    // Theme toggle (persisted)
    const themeKey = 'themePref';
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem(themeKey);
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(themeKey, next);
    }
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    // Mark active link (for cases where server doesn't add .active)
    const path = location.pathname.split('/').pop() || 'index.html';
    $$('.nav-link').forEach((link) => {
        const href = link.getAttribute('href');
        if (href === path) link.classList.add('active');
    });

    // Weather search & geolocation using Open-Meteo APIs
    async function geocodeCity(city, limit = 5) {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.searchParams.set('name', city);
        url.searchParams.set('count', String(limit));
        url.searchParams.set('language', 'en');
        url.searchParams.set('format', 'json');
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to geocode');
        const data = await res.json();
        const results = data?.results || [];
        if (!results.length) throw new Error('City not found');
        const first = results[0];
        return { lat: first.latitude, lon: first.longitude, name: `${first.name}, ${first.country_code}`, results };
    }

    let unit = localStorage.getItem('unit') || 'c'; // 'c' or 'f'

    function toF(c) { return (c * 9/5) + 32; }

    function formatTemp(value) {
        if (value == null || Number.isNaN(value)) return '—';
        return unit === 'f' ? `${Math.round(toF(value))}°F` : `${Math.round(value)}°C`;
    }

    // Track last loaded place (for saving favorites reliably)
    let lastPlace = null; // { name, lat, lon }

    async function fetchWeather(lat, lon) {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', String(lat));
        url.searchParams.set('longitude', String(lon));
        url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m');
        url.searchParams.set('hourly', 'temperature_2m');
        url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max');
        url.searchParams.set('timezone', 'auto');
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch weather');
        return await res.json();
    }

    function renderWeather(container, placeName, weather) {
        const current = weather.current;
        const hourly = weather.hourly;
        const tNow = current?.temperature_2m;
        const feels = current?.apparent_temperature;
        const hum = current?.relative_humidity_2m;
        const wind = current?.wind_speed_10m;

        // Simple description mapping for WMO weather codes (subset)
        const code = current?.weather_code;
        const codeMap = {
            0: 'Clear sky',
            1: 'Mainly clear',
            2: 'Partly cloudy',
            3: 'Overcast',
            45: 'Fog', 48: 'Depositing rime fog',
            51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
            61: 'Slight rain', 63: 'Rain', 65: 'Heavy rain',
            71: 'Slight snow', 73: 'Snow', 75: 'Heavy snow',
            80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers',
            95: 'Thunderstorm'
        };
        const desc = codeMap[code] || 'Weather';

        // Small 6-hour preview
        let preview = '';
        if (hourly?.time && hourly?.temperature_2m) {
            const items = hourly.time.slice(0, 6).map((t, idx) => {
                const hour = new Date(t).toLocaleTimeString([], { hour: '2-digit' });
                const temp = hourly.temperature_2m[idx];
                return `<span>${hour}: ${formatTemp(temp)}</span>`;
            }).join(' • ');
            preview = `<div class="meta">Next hours: ${items}</div>`;
        }

        container.innerHTML = `
            <div class="current">
                <h3>${placeName}</h3>
                <div>${desc}. ${formatTemp(tNow)} (feels ${formatTemp(feels)})</div>
                <div class="meta">Humidity ${Math.round(hum)}% • Wind ${Math.round(wind)} km/h</div>
                ${preview}
            </div>
        `;
    }

    async function loadWeatherForCity(city) {
        const container = $('#weatherResults');
        if (!container) return;
        container.innerHTML = `
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text short"></div>
        `;
        try {
            const { lat, lon, name } = await geocodeCity(city, 1);
            const weather = await fetchWeather(lat, lon);
            renderWeather(container, name, weather);
            renderDaily(weather);
            rememberCity(name, lat, lon);
            drawHourlyChart(weather);
            try {
                const air = await fetchAirQuality(lat, lon);
                renderAirQuality(air);
            } catch {}
            lastPlace = { name, lat, lon };
        } catch (err) {
            console.error(err);
            container.innerHTML = '<span class="muted">Could not load weather. Try another city.</span>';
        }
    }

    async function loadWeatherByCoords(lat, lon, nameLabel = 'Location') {
        const container = $('#weatherResults');
        if (!container) return;
        container.innerHTML = `
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text short"></div>
        `;
        try {
            const weather = await fetchWeather(lat, lon);
            renderWeather(container, nameLabel, weather);
            renderDaily(weather);
            drawHourlyChart(weather);
            try {
                const air = await fetchAirQuality(lat, lon);
                renderAirQuality(air);
            } catch {}
            lastPlace = { name: nameLabel, lat, lon };
        } catch (err) {
            console.error(err);
            container.innerHTML = '<span class="muted">Could not load weather for saved location.</span>';
        }
    }

    async function loadWeatherForGeo() {
        const container = $('#weatherResults');
        if (!container) return;
        container.innerHTML = `
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text short"></div>
        `;
        if (!navigator.geolocation) {
            container.innerHTML = '<span class="muted">Geolocation not supported.</span>';
            return;
        }
        navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
                const { latitude, longitude } = pos.coords;
                const weather = await fetchWeather(latitude, longitude);
                const name = `Your location`;
                renderWeather(container, name, weather);
                renderDaily(weather);
                drawHourlyChart(weather);
                try {
                    const air = await fetchAirQuality(latitude, longitude);
                    renderAirQuality(air);
                } catch {}
                lastPlace = { name, lat: latitude, lon: longitude };
            } catch (err) {
                console.error(err);
                container.innerHTML = '<span class="muted">Could not load weather for your location.</span>';
            }
        }, (err) => {
            console.error(err);
            container.innerHTML = '<span class="muted">Permission denied or unavailable.</span>';
        }, { timeout: 10000 });
    }

    const weatherForm = $('#weatherForm');
    if (weatherForm) {
        weatherForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const city = $('#city').value.trim();
            const errEl = $('.error[data-for="city"]');
            if (!city) {
                if (errEl) errEl.textContent = 'Please enter a city name.';
                return;
            }
            if (errEl) errEl.textContent = '';
            loadWeatherForCity(city);
        });
        const useLocation = $('#useLocation');
        if (useLocation) useLocation.addEventListener('click', loadWeatherForGeo);

        // Auto-complete suggestions
        const cityInput = $('#city');
        const suggestions = $('#suggestions');
        let suggestTimer;
        async function showSuggestions(q) {
            if (!q || q.length < 2) { suggestions.hidden = true; suggestions.innerHTML = ''; return; }
            try {
                const { results } = await geocodeCity(q, 5);
                suggestions.innerHTML = '';
                results.slice(0,5).forEach(r => {
                    const btn = document.createElement('div');
                    btn.className = 'suggestion';
                    btn.innerHTML = `<span>${r.name}${r.admin1 ? ', ' + r.admin1 : ''}</span><span class="meta">${r.country_code}</span>`;
                    btn.addEventListener('click', () => {
                        cityInput.value = `${r.name}`;
                        suggestions.hidden = true; suggestions.innerHTML = '';
                        loadWeatherForCity(`${r.name}`);
                    });
                    suggestions.appendChild(btn);
                });
                suggestions.hidden = suggestions.childElementCount === 0;
            } catch {
                suggestions.hidden = true; suggestions.innerHTML = '';
            }
        }
        if (cityInput && suggestions) {
            cityInput.addEventListener('input', () => {
                clearTimeout(suggestTimer);
                suggestTimer = setTimeout(() => showSuggestions(cityInput.value.trim()), 200);
            });
            cityInput.addEventListener('blur', () => setTimeout(() => { suggestions.hidden = true; }, 200));
            cityInput.addEventListener('focus', () => showSuggestions(cityInput.value.trim()));
        }

        // Favorites (now store objects {name, lat, lon} for reliability)
        const favKey = 'favoriteCitiesV2';
        const favWrap = $('#favorites');
        const saveFavBtn = $('#saveFavorite');
        const clearFavBtn = $('#clearFavorites');
        function loadFavs() {
            let list = [];
            try { list = JSON.parse(localStorage.getItem(favKey)) || []; } catch {}
            // Backward compat: migrate old string-list favorites if present
            try {
                const old = JSON.parse(localStorage.getItem('favoriteCitiesV1')) || [];
                if (Array.isArray(old) && old.length && !list.length) {
                    list = old.map(name => ({ name }));
                    localStorage.setItem(favKey, JSON.stringify(list));
                }
            } catch {}
            return list;
        }
        function setFavs(list) { localStorage.setItem(favKey, JSON.stringify(list)); renderFavs(); }
        function addFav(place) {
            if (!place || !place.name) return;
            const list = loadFavs();
            const exists = list.some(x => x.name === place.name);
            const next = exists ? list : [{ name: place.name, lat: place.lat, lon: place.lon }, ...list];
            setFavs(next.slice(0, 8));
        }
        function renderFavs() {
            if (!favWrap) return;
            const list = loadFavs();
            favWrap.innerHTML = '';
            if (!list.length) { favWrap.hidden = true; return; }
            favWrap.hidden = false;
            list.forEach(item => {
                const wrap = document.createElement('div'); wrap.style.display='flex'; wrap.style.gap='6px';
                const chip = document.createElement('button');
                chip.className = 'chip'; chip.type = 'button'; chip.textContent = item.name;
                chip.addEventListener('click', () => {
                    if (item.lat != null && item.lon != null) loadWeatherByCoords(item.lat, item.lon, item.name);
                    else loadWeatherForCity(item.name);
                });
                const del = document.createElement('button'); del.className='chip'; del.type='button'; del.textContent='✕'; del.title='Remove';
                del.addEventListener('click', () => setFavs(loadFavs().filter(x => x.name !== item.name)));
                wrap.appendChild(chip); wrap.appendChild(del);
                favWrap.appendChild(wrap);
            });
        }
        if (saveFavBtn) {
            saveFavBtn.addEventListener('click', () => {
                if (lastPlace) addFav(lastPlace);
            });
        }
        if (clearFavBtn) clearFavBtn.addEventListener('click', () => setFavs([]));
        renderFavs();

        // Recents management
        const clearRecentsBtn = $('#clearRecents');
        if (clearRecentsBtn) clearRecentsBtn.addEventListener('click', () => { localStorage.removeItem('recentCitiesV1'); renderRecent(); });

        // Deep-link by ?city=Name
        const params = new URLSearchParams(location.search);
        const qCity = params.get('city');
        if (qCity) {
            const cityInput2 = $('#city');
            if (cityInput2) cityInput2.value = qCity;
            loadWeatherForCity(qCity);
        }
    }

    // Contact form handling
    const contactForm = $('#contactForm');
    if (contactForm) {
        const submitBtn = $('#submitBtn');
        const resultEl = $('#formResult');

        function setFieldError(id, message) {
            const el = $(`.error[data-for="${id}"]`);
            if (el) el.textContent = message || '';
        }

        function validateForm() {
            let valid = true;

            const name = $('#name').value.trim();
            const email = $('#email').value.trim();
            const message = $('#message').value.trim();

            setFieldError('name', '');
            setFieldError('email', '');
            setFieldError('message', '');

            if (name.length < 2) {
                setFieldError('name', 'Please enter your full name.');
                valid = false;
            }
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailPattern.test(email)) {
                setFieldError('email', 'Please enter a valid email address.');
                valid = false;
            }
            if (message.length < 10) {
                setFieldError('message', 'Message should be at least 10 characters.');
                valid = false;
            }

            return valid;
        }

        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!validateForm()) return;

            const formData = {
                name: $('#name').value.trim(),
                email: $('#email').value.trim(),
                message: $('#message').value.trim(),
            };

            submitBtn.disabled = true;
            resultEl.hidden = false;
            resultEl.classList.remove('error');
            resultEl.textContent = 'Sending...';

            try {
                // Demo POST endpoint: JSONPlaceholder
                const res = await fetch('https://jsonplaceholder.typicode.com/posts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = await res.json();

                // Persist last submission locally (for demo UX)
                localStorage.setItem('lastContactSubmission', JSON.stringify({
                    payload: formData,
                    responseId: data?.id,
                    at: new Date().toISOString()
                }));

                resultEl.textContent = 'Thanks! Your message was sent (simulated).';
                contactForm.reset();
            } catch (err) {
                console.error(err);
                resultEl.textContent = 'Sorry, something went wrong. Please try again.';
                resultEl.classList.add('error');
            } finally {
                submitBtn.disabled = false;
            }
        });
    }

    // Air quality API and rendering
    async function fetchAirQuality(lat, lon) {
        const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
        url.searchParams.set('latitude', String(lat));
        url.searchParams.set('longitude', String(lon));
        url.searchParams.set('hourly', 'pm2_5,pm10,us_aqi');
        url.searchParams.set('timezone', 'auto');
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch air quality');
        return await res.json();
    }

    function aqiText(aqi) {
        if (aqi == null) return 'Unknown';
        if (aqi <= 50) return 'Good';
        if (aqi <= 100) return 'Moderate';
        if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
        if (aqi <= 200) return 'Unhealthy';
        if (aqi <= 300) return 'Very Unhealthy';
        return 'Hazardous';
    }
    function renderAirQuality(air) {
        const card = $('#airQuality');
        const sum = $('#aqiSummary');
        const det = $('#aqiDetails');
        if (!card || !sum || !det) return;
        const times = air?.hourly?.time || [];
        const aqiSeries = air?.hourly?.us_aqi || [];
        const pm25Series = air?.hourly?.pm2_5 || [];
        const pm10Series = air?.hourly?.pm10 || [];
        if (!times.length) { card.hidden = true; return; }
        const now = Date.now();
        let idx = aqiSeries.findIndex((_, i) => new Date(times[i]).getTime() >= now);
        if (idx < 0) idx = aqiSeries.length - 1;
        const aqi = aqiSeries[idx];
        const pm25 = pm25Series[idx];
        const pm10 = pm10Series[idx];
        sum.textContent = `US AQI: ${Math.round(aqi)} (${aqiText(aqi)})`;
        det.innerHTML = '';
        const mk = (label, value, unit) => {
            const c = document.createElement('span'); c.className='chip';
            c.textContent = `${label}: ${value != null ? Math.round(value) : '—'}${unit || ''}`;
            return c;
        };
        det.appendChild(mk('PM2.5', pm25, ' µg/m³'));
        det.appendChild(mk('PM10', pm10, ' µg/m³'));
        card.hidden = false;
    }

    // Hourly chart (vanilla canvas line chart)
    function drawHourlyChart(weather) {
        const card = $('#hourly');
        const canvas = $('#hourlyChart');
        if (!card || !canvas) return;
        const ctx = canvas.getContext('2d');
        const times = weather?.hourly?.time || [];
        const temps = weather?.hourly?.temperature_2m || [];
        if (!times.length || !temps.length) { card.hidden = true; return; }

        // Next 12 points starting from now
        const now = Date.now();
        const pairs = times.map((t, i) => ({ t: new Date(t).getTime(), v: temps[i] }))
            .filter(p => p.t >= now).slice(0, 12);
        if (!pairs.length) { card.hidden = true; return; }

        const labels = pairs.map(p => new Date(p.t).toLocaleTimeString([], { hour: '2-digit' }));
        const values = pairs.map(p => p.v);

        // Dimensions
        const W = canvas.width; const H = canvas.height;
        ctx.clearRect(0,0,W,H);
        // Background grid
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        for (let i=0;i<5;i++) {
            const y = (H-30) * (i/4) + 10;
            ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W-10, y); ctx.stroke();
        }

        // Scale
        const minV = Math.min(...values) - 2;
        const maxV = Math.max(...values) + 2;
        function yFor(val){ return (H-40) - ( (val - minV) / (maxV - minV) ) * (H-60) + 20; }

        // Axes labels
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '12px Inter, sans-serif';
        labels.forEach((lab, i) => {
            const x = 40 + i * ((W-60) / (labels.length-1));
            ctx.fillText(lab, x-8, H-8);
        });

        // Line
        ctx.strokeStyle = '#6aa3ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        values.forEach((val, i) => {
            const x = 40 + i * ((W-60) / (values.length-1));
            const y = yFor(val);
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        });
        ctx.stroke();

        // Points + value labels
        ctx.fillStyle = '#6aa3ff';
        values.forEach((val, i) => {
            const x = 40 + i * ((W-60) / (values.length-1));
            const y = yFor(val);
            ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
            ctx.fillText(formatTemp(val), x-12, y-8);
        });

        card.hidden = false;
    }

    // Daily forecast rendering (5 days)
    function getIconForCode(code) {
        // Simple emoji icons for quick visual feedback
        if ([0].includes(code)) return '☀️';
        if ([1,2].includes(code)) return '🌤️';
        if ([3].includes(code)) return '☁️';
        if ([45,48].includes(code)) return '🌫️';
        if ([51,53,55,61,63,65,80,81,82].includes(code)) return '🌧️';
        if ([71,73,75].includes(code)) return '❄️';
        if ([95].includes(code)) return '⛈️';
        return '🌡️';
    }

    function renderDaily(weather) {
        const el = $('#dailyForecast');
        const grid = $('#forecastGrid');
        if (!el || !grid) return;

        const d = weather.daily;
        if (!d?.time) { el.hidden = true; return; }

        grid.innerHTML = '';
        const days = d.time.slice(0, 5);
        days.forEach((dateStr, idx) => {
            const date = new Date(dateStr);
            const day = date.toLocaleDateString([], { weekday: 'short' });
            const icon = getIconForCode(d.weather_code[idx]);
            const tmax = formatTemp(d.temperature_2m_max[idx]);
            const tmin = formatTemp(d.temperature_2m_min[idx]);
            const rise = new Date(d.sunrise[idx]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const set = new Date(d.sunset[idx]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const pop = d.precipitation_probability_max?.[idx];
            const card = document.createElement('div');
            card.className = 'forecast-card';
            card.innerHTML = `
                <div class="icon">${icon}</div>
                <div class="day">${day}</div>
                <div class="range">${tmax} / ${tmin}</div>
                <div class="meta">☀️ ${rise} • 🌙 ${set}</div>
                <div class="meta">Precip: ${pop != null ? pop + '%' : '—'}</div>
            `;
            grid.appendChild(card);
        });
        el.hidden = false;
    }

    // Unit toggle
    const unitC = $('#unitC');
    const unitF = $('#unitF');
    function setUnit(next) {
        unit = next;
        localStorage.setItem('unit', unit);
        if (unitC && unitF) {
            unitC.setAttribute('aria-pressed', unit === 'c' ? 'true' : 'false');
            unitF.setAttribute('aria-pressed', unit === 'f' ? 'true' : 'false');
        }
        // Re-render if there is existing content
        const nameEl = document.querySelector('#weatherResults .current h3');
        if (nameEl) {
            const title = nameEl.textContent || 'Location';
            // Try to infer last coords from recent or from geo; fallback: search again by title
            // Lightweight: trigger city search by title (may differ from exact coords)
            loadWeatherForCity(title.replace(/,.*$/, ''));
        }
    }
    if (unitC && unitF) {
        unitC.addEventListener('click', () => setUnit('c'));
        unitF.addEventListener('click', () => setUnit('f'));
        setUnit(unit); // initialize state
    }

    // Recent searches
    const recentKey = 'recentCitiesV1';
    function rememberCity(name, lat, lon) {
        let list = [];
        try { list = JSON.parse(localStorage.getItem(recentKey)) || []; } catch {}
        // Prevent duplicates by name
        list = [{ name, lat, lon }, ...list.filter(x => x.name !== name)].slice(0, 6);
        localStorage.setItem(recentKey, JSON.stringify(list));
        renderRecent();
    }
    function renderRecent() {
        const wrap = $('#recentSearches');
        if (!wrap) return;
        let list = [];
        try { list = JSON.parse(localStorage.getItem(recentKey)) || []; } catch {}
        if (!list.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
        wrap.hidden = false;
        wrap.innerHTML = '';
        list.forEach(item => {
            const chip = document.createElement('button');
            chip.className = 'chip';
            chip.type = 'button';
            chip.textContent = item.name;
            if (item.lat != null && item.lon != null) {
                chip.addEventListener('click', () => loadWeatherByCoords(item.lat, item.lon, item.name));
            } else {
                chip.addEventListener('click', () => loadWeatherForCity(item.name));
            }
            wrap.appendChild(chip);
        });
    }
    renderRecent();
})();


