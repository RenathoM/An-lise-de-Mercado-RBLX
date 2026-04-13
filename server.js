// Dependências necessárias: npm install express axios node-cache cors
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const cors = require('cors');

const app = express();
app.use(cors());

// Cache de 60 segundos para evitar Rate Limit (Banimento temporário de IP) pelo Roblox
const marketCache = new NodeCache({ stdTTL: 60 }); 

// Dicionário de Universe IDs dos jogos (A API do Roblox usa UniverseId, não PlaceId para CCU)
// Exemplo com IDs reais aproximados das Blue Chips
const ASSETS = {
    BLXF: 2753915549, // Blox Fruits
    BRKH: 1730877806, // Brookhaven
    BLDE: 4777817887  // Blade Ball
};

// Algoritmo Preditivo Simples (Cálculo de Variação)
function calculateTrend(currentCcu, previousCcu) {
    if (!previousCcu) return { status: 'Estável', action: 'HOLD', forecast: currentCcu };
    const variation = ((currentCcu - previousCcu) / previousCcu) * 100;
    
    if (variation > 2) return { status: 'Alta Forte', action: 'SELL_SOON', forecast: Math.floor(currentCcu * 1.05) };
    if (variation < -2) return { status: 'Baixa Forte', action: 'BUY', forecast: Math.floor(currentCcu * 0.95) };
    return { status: 'Estável', action: 'HOLD', forecast: currentCcu };
}

app.get('/api/market-data', async (req, res) => {
    try {
        // 1. Verifica se temos dados frescos no cache (Proteção contra erros e atrasos)
        if (marketCache.has('live_market')) {
            return res.json(marketCache.get('live_market'));
        }

        // 2. Constrói a URL da API oficial do Roblox
        const universeIds = Object.values(ASSETS).join(',');
        const robloxUrl = `https://games.roblox.com/v1/games?universeIds=${universeIds}`;

        // 3. Chamada à API
        const response = await axios.get(robloxUrl);
        const gamesData = response.data.data;

        // 4. Estruturação e Análise de Dados
        let marketAnalysis = {};
        const previousData = marketCache.get('previous_market') || {}; // Pega dados de 1 minuto atrás

        gamesData.forEach(game => {
            // Identifica o Ticker com base no Universe ID
            const ticker = Object.keys(ASSETS).find(key => ASSETS[key] === game.id);
            const currentCcu = game.playing;
            const prevCcu = previousData[ticker]?.ccu || currentCcu;

            marketAnalysis[ticker] = {
                name: game.name,
                ccu: currentCcu,
                visits: game.visits,
                trend: calculateTrend(currentCcu, prevCcu)
            };
        });

        // 5. Atualiza o Cache de curto e médio prazo
        marketCache.set('live_market', marketAnalysis);
        marketCache.set('previous_market', marketAnalysis, 120); // Guarda o estado anterior por 2 min

        res.json(marketAnalysis);

    } catch (error) {
        console.error("Erro na API do Roblox:", error.message);
        // Fallback: Retorna o último dado conhecido caso a API do Roblox caia (Alta Resiliência)
        const fallbackData = marketCache.get('previous_market');
        if (fallbackData) {
            return res.json(fallbackData);
        }
        res.status(502).json({ error: "Roblox API Indisponível e sem cache." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Atlas Studios] Market Backend rodando na porta ${PORT}`);
});
