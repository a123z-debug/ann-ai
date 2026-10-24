const adapter = require('../lib/adapter');
const o = require('../lib/orders');
module.exports = adapter({ POST: o.verifyPayment });
