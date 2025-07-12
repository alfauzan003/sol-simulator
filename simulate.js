const axios = require("axios");
const { SocksProxyAgent } = require("socks-proxy-agent");
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");

const CSV_FILE = path.join(__dirname, "trades.csv");

let balance = 2.0;
const buyAmountSol = 0.02;
const takeProfitMultiplier = 2.0;
const openPositions = {}; // { ca: { entryPrice, tokenAmount, interval } }

const torAgent = new SocksProxyAgent("socks5h://127.0.0.1:9050");

// === Change Timestamp to UTC+7 ===
function getLocalTimestamp() {
    return DateTime.now()
        .setZone("Asia/Jakarta")
        .toFormat("yyyy-MM-dd HH:mm:ss");
}

// === Create CSV with header if missing ===
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

// === Log trade to CSV ===
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

// === Get price in SOL ===
async function getPrice(ca) {
    const SOL_CA = "So11111111111111111111111111111111111111112";
    const url = "https://lite-api.jup.ag/price/v3";
    const ids = `${SOL_CA},${ca}`;

    try {
        const res = await axios.get(url, {
            params: { ids },
            httpsAgent: torAgent,
            timeout: 3000,
        });

        const data = res.data;
        const solPrice = data[SOL_CA]?.usdPrice;
        const tokenPrice = data[ca]?.usdPrice;

        if (!solPrice || !tokenPrice) return null;
        return tokenPrice / solPrice;
    } catch (err) {
        console.error(`[Tor Error] ${err.message}`);
        return null;
    }
}

// === Rebuild open positions from CSV ===
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
            });
        } else if (type === "SELL") {
            map.delete(ca);
        }
    }

    for (const [ca, data] of map.entries()) {
        openPositions[ca] = data;
        console.log(`[🔄] Resuming monitoring for ${ca}`);
        startMonitoringPrice(ca);
    }
}

// === Monitor price for 2x profit ===
function startMonitoringPrice(ca) {
    const interval = setInterval(async () => {
        const currentPrice = await getPrice(ca);
        if (!currentPrice) return;

        const pos = openPositions[ca];
        if (!pos) {
            clearInterval(interval);
            return;
        }

        const targetPrice = pos.entryPrice * takeProfitMultiplier;
        console.log(
            `📊 ${ca} | Entry: ${pos.entryPrice.toFixed(
                9
            )} | Now: ${currentPrice.toFixed(9)}`
        );

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

            clearInterval(interval);
            delete openPositions[ca];
            console.log(
                `✅ Sold ${ca} at ${currentPrice}. New balance: ${balance.toFixed(
                    4
                )} SOL`
            );
        }
    }, 700);

    openPositions[ca].interval = interval;
}

// === Main Simulation Entry ===
const simulate = async function (ca) {
    ensureCSVHeader();

    // Load open positions if not already loaded
    if (Object.keys(openPositions).length === 0) {
        rebuildOpenPositions();
    }

    if (openPositions[ca]) {
        console.log(`[ℹ️] Already monitoring ${ca}`);
        return;
    }

    const entryPrice = await getPrice(ca);
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
    };

    startMonitoringPrice(ca);
};

async function startMonitoringAll() {
    ensureCSVHeader();
    rebuildOpenPositions();
}

module.exports = {
    simulate,
    startMonitoringAll,
};
