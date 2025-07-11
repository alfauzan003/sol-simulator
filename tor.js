require("dotenv").config();
const tor = require("tor-request");

tor.setTorAddress("127.0.0.1", 9050);

tor.TorControlPort.host = "127.0.0.1";
tor.TorControlPort.port = 9051;
tor.TorControlPort.password = process.env.TOR_PASSWORD; // <-- your original password

function rotateTorIP() {
    return new Promise((resolve, reject) => {
        tor.renewTorSession((err, msg) => {
            if (err) {
                console.error("[Tor] IP rotation failed:", err.message);
                return reject(err);
            }
            console.log("[Tor] New IP signal sent:", msg);
            resolve();
        });
    });
}

module.exports = rotateTorIP;
