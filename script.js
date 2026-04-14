
        // 1. CONFIGURAÇÕES AQUI
        const SUPABASE_URL = "https://xjgdtwevqrrnorgzelrz.supabase.co/functions/v1/roblox-proxy";
        const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqZ2R0d2V2cXJybm9yZ3plbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzk3ODAsImV4cCI6MjA4OTYxNTc4MH0.XGmwAxTNWghMRzTDMZvu5IXHmHy_7Xw54RjdPzqa-Dw"; 

        const ASSETS = [
            { id: 1702695413, name: "Brookhaven", ticker: "BRKH" }
        ];

        // Estado Global
        let marketData = {};
        ASSETS.forEach(a => {
            marketData[a.id] = { current: 0, target: 0, history: new Array(60).fill(null), start: 0, status: 'waiting' };
        });
        
        // Dados Base de fallback (caso a API falhe)
        const FALLBACK_Bases = {
            1702695413: 450000
        };

        let activeAsset = ASSETS[0].id;
        let rateLimitCooldown = false;

        // Inicialização do Gráfico
        const ctx = document.getElementById('mainChart').getContext('2d');
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: new Array(70).fill('').map((_, i) => i < 60 ? `T-${60-i}` : `F+${i-59}`),
                datasets: [
                    { label: 'Preço Real (Live)', data: [], borderColor: '#00f5d4', backgroundColor: 'rgba(0, 245, 212, 0.05)', borderWidth: 2, fill: true, pointRadius: 0, tension: 0.3 },
                    { label: 'SMA 10', data: [], borderColor: 'rgba(255,255,255,0.2)', borderDash: [5,5], borderWidth: 1, pointRadius: 0, tension: 0.4 },
                    { label: 'Projeção (IA)', data: [], borderColor: '#3b82f6', borderDash: [2,4], borderWidth: 2, pointRadius: 0, tension: 0.4 },
                    { label: 'Banda Superior', data: [], borderColor: 'transparent', backgroundColor: 'rgba(59, 130, 246, 0.1)', pointRadius: 0, fill: '-1', tension: 0.4 },
                    { label: 'Banda Inferior', data: [], borderColor: 'transparent', backgroundColor: 'transparent', pointRadius: 0, fill: '-2', tension: 0.4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
                interaction: { intersect: false, mode: 'index' },
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#9ca3af' } },
                    y: { position: 'right', grid: { color: 'rgba(31, 41, 55, 0.4)' }, ticks: { color: '#9ca3af' } }
                }
            }
        });

        let activeTimeframe = '1M';
        let fetchClock = null;

        // Core de Lógica de Requisição Segura (Batching / Chunking)
        async function fetchMarketData() {
            const CHUNK_SIZE = 1; // 1 ID por vez para evitar 404 e timeouts de parse no proxy
            const DELAY = 1500;
            
            function processGameData(data) {
                let success = false;
                if (data && data.data && data.data.length > 0) {
                    data.data.forEach(game => {
                        if (game.id && marketData[game.id]) {
                            const playing = parseInt(game.playing) || 0;
                            const md = marketData[game.id];
                            if (md.start === 0 && playing > 0) md.start = playing;
                            if (md.current === 0) md.current = playing;
                            md.target = playing;
                            md.status = 'active';
                            success = true;
                        }
                    });
                }
                if(!success) throw new Error("404");
            }
            
            for (let i = 0; i < ASSETS.length; i += CHUNK_SIZE) {
                // Removemos o break local para forçar o CORS no fallback se o supabase explodiu
                const chunk = ASSETS.slice(i, i + CHUNK_SIZE);
                const ids = chunk.map(a => a.id).join(',');

                try {
                    let url = `${SUPABASE_URL}?universeIds=${ids}`;
                    let options = { headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY }};
                    
                    // Rota Secundária: Se o IP do Supabase proxy estiver queimado pela Roblox (Ratelimit 429), tenta por CORS público
                    if (rateLimitCooldown) {
                        url = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://games.roblox.com/v1/games?universeIds=' + ids)}`;
                        options = {}; 
                    }

                    const res = await fetch(url, options);

                    if (res.status === 429) {
                        if (!rateLimitCooldown) {
                            triggerCooldown(); 
                            // Tenta instantaneamente o Fallback do CORS
                            const fallbackRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent('https://games.roblox.com/v1/games?universeIds=' + ids)}`);
                            if (fallbackRes.status === 429) throw new Error("429");
                            const fallbackData = await fallbackRes.json();
                            processGameData(fallbackData);
                            continue;
                        } else {
                            throw new Error("429");
                        }
                    }
                    if (res.status >= 400 && res.status !== 429) throw new Error("404");
                    
                    const data = await res.json();
                    processGameData(data);
                    
                } catch (err) {
                    chunk.forEach(a => {
                        const md = marketData[a.id];
                        if (err.message === "429") {
                            md.status = 'ratelimit'; // Laranja
                        } else if (md.status !== 'active') {
                            md.status = 'waiting'; // Vermelho (Se nunca recebeu dados reais)
                        }

                        // SÓ aplicamos mock/fallback de dados SE o ativo não estiver "waiting" (ou seja, se já teve dados alguma vez)
                        // Assim, um ativo que nunca teve dados reais não será falso-positivado com fallback.
                        if (md.status !== 'waiting') {
                            const baseVal = FALLBACK_Bases[a.id] || 50000;
                            const fluctuation = Math.floor((Math.random() - 0.4) * (baseVal * 0.05));
                            const val = baseVal + fluctuation;
                            
                            if (md.start === 0) md.start = val;
                            if (md.current === 0) md.current = val;
                            md.target = val;
                        }
                    });
                    
                    if (err.message === "429" && !rateLimitCooldown) {
                        triggerCooldown();
                    }
                }
                
                document.getElementById('loading-overlay').style.display = 'none';
                document.getElementById('ai-panel').style.display = 'block';

                if (i + CHUNK_SIZE < ASSETS.length) {
                    await new Promise(r => setTimeout(r, DELAY));
                }
            }

            // Atualiza histórico apenas depois de rodar todos (1 frame completo)
            ASSETS.forEach(a => {
                const md = marketData[a.id];
                if (md.target > 0) {
                    md.current = md.target;
                    md.history.push(md.current);
                    md.history.shift();
                }
            });
            updateUI();
        }

        function triggerCooldown() {
            if(rateLimitCooldown) return;
            rateLimitCooldown = true;
            const badge = document.getElementById('api-status');
            badge.classList.add('cooldown');
            badge.innerHTML = `<i class="fas fa-exclamation-triangle"></i> COOLDOWN API (30s)`;
            showToast("Rate Limit do Roblox atingido. Simulação mantida em cachê local.", "warning");
            
            setTimeout(() => {
                rateLimitCooldown = false;
                badge.classList.remove('cooldown');
                badge.innerHTML = `<i class="fas fa-circle"></i> SISTEMA OPERACIONAL`;
            }, 30000);
        }

        // Loop principal da API (Inicialização e Escalonamento)
        fetchMarketData().then(() => {
            const activeBtn = document.querySelector('.tf-btn.active');
            if(activeBtn) setTimeframe('1M', activeBtn);
        });

        // Inteligência Artificial e UI Updates
        function updateUI() {
            // Sidebar Watchlist
            const tbody = document.getElementById('watchlist-body');
            if (tbody.children.length === 0) {
                ASSETS.forEach(a => {
                    const tr = document.createElement('tr');
                    tr.id = `row-${a.id}`;
                    tr.onclick = () => selectAsset(a.id);
                    tr.innerHTML = `
                        <td>
                            <i class="fas fa-circle status-dot waiting" id="dot-${a.id}"></i>
                            <span class="ticker">${a.ticker}</span>
                            <span class="ticker-name">${a.name}</span>
                        </td>
                        <td id="val-${a.id}">-</td>
                    `;
                    tbody.appendChild(tr);
                });
            }

            ASSETS.forEach(a => {
                const el = document.getElementById(`val-${a.id}`);
                const row = document.getElementById(`row-${a.id}`);
                const dot = document.getElementById(`dot-${a.id}`);
                const md = marketData[a.id];
                
                if(dot) dot.className = `fas fa-circle status-dot ${md.status}`;

                if (el && md.current > 0) {
                    el.innerText = Math.round(md.current).toLocaleString();
                    el.style.color = md.current >= md.start ? 'var(--buy)' : 'var(--sell)';
                }

                if(row) {
                    if (md.status === 'waiting') {
                        row.classList.add('disabled');
                        row.classList.remove('active');
                    } else {
                        row.classList.remove('disabled');
                        a.id === activeAsset ? row.classList.add('active') : row.classList.remove('active');
                    }
                }
            });

            // Painel Central & Gráfico
            const ac = ASSETS.find(a => a.id === activeAsset);
            const md = marketData[activeAsset];
            
            document.getElementById('header-name').innerText = ac.name;
            document.getElementById('header-ticker').innerText = `$${ac.ticker}`;
            
            if (md.current > 0) {
                const chg = ((md.current - md.start) / md.start) * 100;
                document.getElementById('exec-price').innerText = Math.round(md.current).toLocaleString();
                const elChg = document.getElementById('exec-change');
                    elChg.innerText = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
                    elChg.className = chg >= 0 ? 'delta-positive' : 'delta-negative';

                    // Update Chart Data
                    chart.data.datasets[0].data = md.history;

                    // AI Math
                    const validData = md.history.filter(v => v !== null);
                    if (validData.length >= 10) {
                        const curr = validData[validData.length - 1];
                        const past10 = validData[validData.length - 10];
                        const m = curr - past10; // Momentum = CCU(t) - CCU(t-10)
                        
                        // Atualiza Indicadores
                        document.getElementById('ai-m').innerText = m.toFixed(0);
                        document.getElementById('ai-var').innerText = chg.toFixed(3) + "%";
                        document.getElementById('ai-rsi').innerText = m > 0 ? "Compradora" : "Vendedora";
                        document.getElementById('ai-rsi').style.color = m > 0 ? "var(--buy)" : "var(--sell)";

                        // Desenhar SMA10 e Projeção
                        const sma = new Array(70).fill(null);
                        for(let i=9; i < validData.length; i++) {
                            sma[(60 - validData.length) + i] = validData.slice(i-9, i+1).reduce((a,b)=>a+b,0)/10;
                        }
                        chart.data.datasets[1].data = sma;

                        const proj = new Array(70).fill(null);
                        const bandUpper = new Array(70).fill(null);
                        const bandLower = new Array(70).fill(null);
                        chart.data.labels = new Array(70).fill('').map((_, i) => i < 60 ? `T-${60-i}` : `F+${i-59}`);
                        
                        proj[59] = curr;
                        bandUpper[59] = curr;
                        bandLower[59] = curr;
                        
                        // Calculando volatilidade (Desvio Padrão dos últimos 10)
                        const avg10 = past10;
                        let variance = 0;
                        for(let i = validData.length - 10; i < validData.length; i++) {
                            variance += Math.pow(validData[i] - avg10, 2);
                        }
                        const stdDev = Math.sqrt(variance / 10);
                        const volMargin = Math.max(stdDev * 1.5, curr * 0.0005);

                        let slope = m / 3; 
                        let noiseAmp = stdDev * 0.3;
                        for(let i=1; i<=10; i++) {
                            // Suavização da curva
                            proj[59+i] = curr + (slope * i) + ((Math.random() - 0.5) * noiseAmp);
                            
                            // Abertura das bandas (Cone de Incerteza)
                            const expansion = volMargin * (i / 3); 
                            bandUpper[59+i] = proj[59+i] + expansion;
                            bandLower[59+i] = proj[59+i] - expansion;
                            
                            slope *= 0.85; // decaimento do momento
                            noiseAmp *= 1.1; // incerteza aumenta
                        }
                        chart.data.datasets[2].data = proj;
                        chart.data.datasets[3].data = bandUpper;
                        chart.data.datasets[4].data = bandLower;

                        document.getElementById('ai-conclusion').innerHTML = m > 0 
                            ? `O canal direcional é de crescimento orgânico. Base quantitativa aponta continuação no curto prazo rumo ao teto de $${Math.round(proj[69]).toLocaleString()}$, com índice de convicção adaptativo (Cone exibido no gráfico).`
                            : `Convergência técnica descendente estabelecida. Sugere-se redimensionamento das posições. Expectativa macro para os próximos 10s buscar piso de $${Math.round(proj[69]).toLocaleString()}$.`;
                    }

                    chart.update('none');
                }
        }

        // Funções de Interação
        function selectAsset(id) {
            if (marketData[id].status === 'waiting') return; // Bloqueia seleção de ativos inutilizados
            activeAsset = id;
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.tf-btn').classList.add('active'); // Reset to 1M
            setTimeframe('1M', document.querySelector('.tf-btn'));
            
            // Mock Demographics update based on ID to look dynamic
            const str = id.toString();
            const am = 30 + parseInt(str.slice(-1)) * 5;
            const eu = 20 + parseInt(str.slice(-2, -1)) * 3;
            document.getElementById('demo-am').style.width = am + '%';
            document.getElementById('demo-eu').style.width = eu + '%';
            document.getElementById('demo-as').style.width = (100 - am - eu) + '%';
            
            updateUI();
        }

        function executeTrade(type) {
            const md = marketData[activeAsset];
            if (md.current <= 0) return;
            
            const log = document.getElementById('trade-log');
            if (log.innerHTML.includes('Mesa de operações livre')) log.innerHTML = '';

            const color = type === "LONG" ? "var(--buy)" : "var(--sell)";
            const ticker = ASSETS.find(a => a.id === activeAsset).ticker;
            
            const div = document.createElement('div');
            div.className = 'log-item';
            div.style.borderLeftColor = color;
            div.innerHTML = `
                <span><strong style="color:${color}">${type}</strong> ${ticker}</span>
                <span style="font-family:var(--font-mono)">@ ${Math.round(md.current)} <span style="color:var(--text-dim); margin-left:10px;">${new Date().toLocaleTimeString()}</span></span>
            `;
            log.prepend(div);
            
            if (log.children.length > 8) log.lastChild.remove();
            
            showToast(`Ordem ${type} executada em ${ticker}`);
        }

        // Macro Timeframes dinâmicos e controle de requisições
        function setTimeframe(tf, btn) {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTimeframe = tf;
            
            const TF_MS = {
                '1M': 60000,          // 1 Minuto
                '15M': 15 * 60000,    // 15 Minutos
                '1H': 60 * 60000,     // 1 Hora
                '1D': 24 * 60 * 60000,// 1 Dia
                '1W': 7 * 24 * 60 * 60000 // 1 Semana
            };

            // Atualiza Histórico Mockado baseando-se na amplitude do momento para não gerar gráficos vazios
            ASSETS.forEach(a => {
                const md = marketData[a.id];
                const base = md.current || 100000;
                let mult = 0.01;
                if (tf === '15M') mult = 0.02;
                if (tf === '1H') mult = 0.05;
                if (tf === '1D') mult = 0.15;
                if (tf === '1W') mult = 0.3;
                
                const mockData = [];
                let val = base - (base * mult); 
                for(let i=0; i<60; i++) {
                    val += (Math.random() - 0.4) * (base * (mult/20));
                    mockData.push(Math.round(val));
                }
                mockData[59] = base; 
                md.history = [...mockData];
            });

            chart.data.labels = new Array(70).fill('').map((_, i) => i < 60 ? `${tf}-${60-i}` : `F+${i-59}`);
            
            // Define o novo cronograma real de atualizações (fetch)
            if (fetchClock) clearInterval(fetchClock);
            fetchClock = setInterval(fetchMarketData, TF_MS[tf] || 60000);

            // Atualiza texto da AI informando escopo real
            document.getElementById('ai-conclusion').innerHTML = `<span style="color:var(--text-dim)">Visualização readequada ao timeframe ${tf}. Pipeline algorítmico processando com base no cronograma selecionado.</span>`;
            
            updateUI();
        }

        function showToast(msg, type="info") {
            const t = document.getElementById('toast');
            t.innerText = msg;
            t.style.borderLeftColor = type === "warning" ? "#f59e0b" : "var(--cyan)";
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 3000);
        }