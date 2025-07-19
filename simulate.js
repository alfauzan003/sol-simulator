const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");
const { SocksProxyAgent } = require("socks-proxy-agent");

const CSV_FILE = path.join(__dirname, "trades.csv");

let balance = 2.0;
const buyAmountSol = 0.02;
const takeProfitMultiplier = 2.0;
const openPositions = {}; // { ca: { entryPrice, tokenAmount, hasLogged } }

const torAgent = new SocksProxyAgent("socks5h://127.0.0.1:9050");

function getLocalTimestamp() {
    return DateTime.now()
        .setZone("Asia/Jakarta")
        .toFormat("yyyy-MM-dd HH:mm:ss");
}

function ensureCSVHeader() {
    if (!fs.existsSync(CSV_FILE)) {
        const header =
            [
                "Timestamp",
                "CA",
                "Type",
                "Amount (SOL)",
                "Amount (Token)",
                "Price",
                "Remaining Balance (SOL)",
            ].join(",") + "\n";
        fs.writeFileSync(CSV_FILE, header);
    }
}

function logTrade({ type, ca, solAmount, tokenAmount, price }) {
    ensureCSVHeader();
    const row =
        [
            getLocalTimestamp(),
            ca,
            type,
            solAmount,
            tokenAmount,
            price,
            balance.toFixed(4),
        ].join(",") + "\n";

    fs.appendFileSync(CSV_FILE, row);
    console.log(`[📄] ${type} ${ca} logged to CSV`);
}

async function getBatchedPrices(caList) {
    const SOL_CA = "So11111111111111111111111111111111111111112";
    const url = "https://lite-api.jup.ag/price/v3";

    // Split into chunks of 49 tokens (because SOL_CA is always included)
    const chunks = [];
    for (let i = 0; i < caList.length; i += 49) {
        chunks.push(caList.slice(i, i + 49));
    }

    const finalPrices = {};

    for (const chunk of chunks) {
        const ids = [SOL_CA, ...chunk].join(",");

        try {
            const res = await axios.get(url, {
                params: { ids },
                httpsAgent: torAgent,
                timeout: 5000,
            });

            const data = res.data;
            const solPrice = data[SOL_CA]?.usdPrice;
            if (!solPrice) continue;

            for (const ca of chunk) {
                const tokenPrice = data[ca]?.usdPrice;
                if (tokenPrice) {
                    finalPrices[ca] = tokenPrice / solPrice;
                }
            }
        } catch (err) {
            console.error(`[Tor Error] Chunk fetch failed: ${err.message}`);
        }
    }

    return finalPrices;
}

async function getPriceForOne(ca) {
    const prices = await getBatchedPrices([ca]);
    return prices[ca] || null;
}

function startMonitoringAllPrices() {
    console.log("🚀 Starting batch price monitor");

    setInterval(async () => {
        const tokenList = Object.keys(openPositions);
        if (tokenList.length === 0) return;

        const prices = await getBatchedPrices(tokenList);

        try {
            for (const ca of tokenList) {
                const pos = openPositions[ca];
                const currentPrice = prices[ca];

                // 🔒 Add full safety check
                if (!currentPrice || !pos) continue;

                const targetPrice = pos.entryPrice * takeProfitMultiplier;
                if (!pos.hasLogged && currentPrice >= targetPrice * 0.9) {
                    console.log(
                        `📈 ${ca} nearing target: ${currentPrice.toFixed(
                            9
                        )} / ${targetPrice.toFixed(9)}`
                    );
                    pos.hasLogged = true;
                }

                if (currentPrice >= targetPrice) {
                    const grossSol = pos.tokenAmount * currentPrice;
                    const earnedSol = grossSol * 0.99;
                    balance += earnedSol - 0.0007;

                    logTrade({
                        type: "SELL",
                        ca,
                        solAmount: earnedSol,
                        tokenAmount: pos.tokenAmount,
                        price: currentPrice,
                    });

                    delete openPositions[ca];
                    console.log(
                        `✅ Sold ${ca} at ${currentPrice}. Balance: ${balance.toFixed(
                            4
                        )} SOL`
                    );
                }
            }
        } catch (err) {
            console.error(`[Monitor Loop Error] ${err.message}`);
        }
    }, 3000);
}

function rebuildOpenPositions() {
    if (!fs.existsSync(CSV_FILE)) return;

    const lines = fs.readFileSync(CSV_FILE, "utf-8").split("\n").slice(1);
    const map = new Map();

    for (const line of lines) {
        if (!line.trim()) continue;
        const [_, ca, type, __, token, price] = line.split(",");

        if (type === "BUY") {
            map.set(ca, {
                entryPrice: parseFloat(price),
                tokenAmount: parseFloat(token),
                hasLogged: false,
            });
        } else if (type === "SELL") {
            map.delete(ca);
        }
    }

    for (const [ca, data] of map.entries()) {
        openPositions[ca] = data;
        console.log(`🔄 Resuming monitoring for ${ca}`);
    }
}

const simulate = async function (ca) {
    ensureCSVHeader();

    if (Object.keys(openPositions).length === 0) {
        rebuildOpenPositions();
    }

    if (openPositions[ca]) {
        console.log(`[ℹ️] Already monitoring ${ca}`);
        return;
    }

    const entryPrice = await getPriceForOne(ca);
    if (!entryPrice) {
        console.log(`[❌] Price unavailable for ${ca}`);
        return;
    }

    if (balance < buyAmountSol) {
        console.log(`[⛔] Not enough SOL to buy ${ca}`);
        return;
    }

    const effectiveSol = buyAmountSol * 0.99;
    const tokenAmount = effectiveSol / entryPrice;
    balance -= buyAmountSol + 0.0007;

    logTrade({
        type: "BUY",
        ca,
        solAmount: buyAmountSol,
        tokenAmount,
        price: entryPrice.toFixed(9),
    });

    openPositions[ca] = {
        entryPrice,
        tokenAmount,
        hasLogged: false,
    };
};

async function startMonitoringAll() {
    ensureCSVHeader();
    rebuildOpenPositions();
    startMonitoringAllPrices();
}

module.exports = {
    simulate,
    startMonitoringAll,
};
