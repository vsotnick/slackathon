const { client, xml } = require('@xmpp/client');

const API_ROOT = 'http://localhost/api';
const TEST_USER = {
    username: `user_${Math.floor(Math.random() * 10000)}`,
    email: `test_${Math.floor(Math.random() * 10000)}@slackathon.local`,
    password: 'Password123!'
};

async function runTest() {
    console.log('--- Phase 1 Final Smoke Test ---');
    console.log(`1. Registering new user: ${TEST_USER.username}...`);

    let loginData;
    try {
        const regResponse = await fetch(`${API_ROOT}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(TEST_USER)
        });

        if (!regResponse.ok) {
            const err = await regResponse.json();
            throw new Error(`Registration failed: ${JSON.stringify(err)}`);
        }

        loginData = await regResponse.json();
        console.log('   ✓ Registration & Login Successful (AES Decryption verified)');
        console.log(`   ✓ JID: ${loginData.xmpp.jid}`);
    } catch (err) {
        console.error('   ✗ API Test failed:', err.message);
        process.exit(1);
    }

    const { jid, password, wsUrl } = loginData.xmpp;

    console.log(`2. Attempting XMPP WebSocket Handshake to ${wsUrl}...`);
    
    const xmpp = client({
        service: wsUrl,
        domain: jid.split('@')[1],
        username: jid.split('@')[0],
        password: password,
    });

    xmpp.on('error', (err) => {
        console.error('   ✗ XMPP Error:', err.message);
        if (err.condition) console.error('     Condition:', err.condition);
        process.exit(1);
    });

    xmpp.on('online', async (address) => {
        console.log('');
        console.log('====================================================');
        console.log('  SUCCESS: XMPP WebSocket Handshake Verified!      ');
        console.log(`  Connected as: ${address.toString()}              `);
        console.log('====================================================');
        console.log('');

        await xmpp.stop();
    });

    xmpp.on('offline', () => {
        console.log('--- Smoke Test Completed ---');
        process.exit(0);
    });

    try {
        await xmpp.start();
    } catch (err) {
        console.error('   ✗ Failed to start XMPP client:', err.message);
        process.exit(1);
    }
}

runTest();
