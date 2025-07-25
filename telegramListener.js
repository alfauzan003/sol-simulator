require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const { NewMessage } = require("telegram/events");
const { Api } = require("telegram");
const rotateTorIP = require("./tor");
const fs = require("fs");
const { simulate, startMonitoringAll } = require("./simulate");

const apiId = parseInt(process.env.API_ID, 10);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.SESSION_STRING || "");

setInterval(() => {
    rotateTorIP().catch(() => {});
}, 15 * 1000);

function updateEnvSession(newSessionString) {
    const envPath = ".env";
    const envContent = fs.readFileSync(envPath, "utf8");

    const updatedContent = envContent.replace(
        /SESSION_STRING=.*/,
        `SESSION_STRING=${newSessionString}`
    );

    fs.writeFileSync(envPath, updatedContent);
    console.log("✅ .env updated with new session string.");
}

(async () => {
    console.log("Connecting to Telegram...");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text("Phone number: "),
        password: async () => await input.text("2FA password: "),
        phoneCode: async () => await input.text("Code: "),
        onError: (err) => console.log(err),
    });

    console.log("✅ Connected.");
    const newSession = client.session.save();
    console.log("🔐 Save this updated session string to .env:");
    console.log(newSession);
    updateEnvSession(newSession);

    await client.getDialogs(); // Force login

    startMonitoringAll();

    client.addEventHandler(async (event) => {
        const msg = event.message;
        const text = msg.message;
        const entities = msg.entities || [];

        const sender = await msg.getSender();
        if (!sender || sender.username !== "solearlytrending") return;
        if (!text.includes("Hodls:") || !text.includes("✅")) return;

        for (const entity of entities) {
            if (entity instanceof Api.MessageEntityTextUrl) {
                const match = entity.url.match(
                    /start=[^_]+_([1-9A-HJ-NP-Za-km-z]{32,44})/
                );
                // console.log("entities:", entity);
                if (match) {
                    const ca = match[1];
                    console.log("Extracted CA", ca);
                    simulate(ca);
                    break;
                }
            }
        }
    }, new NewMessage());
})();
