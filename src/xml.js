const xmlBuilder = require('xmlbuilder');

function success(username, attributes, pgtId) {
	var success = xmlBuilder.create('cas:serviceResponse', {'xmlns:cas': 'http://www.yale.edu/tp/cas'})
		.att('xmlns:cas', 'http://www.yale.edu/tp/cas')
		.ele('cas:authenticationSuccess').ele('cas:user', username).up()
		.ele('cas:attributes');

	Object.keys(attributes).forEach(item => {
		success.ele(`cas:${item}`, attributes[item]);
	});

	return success.up()
		.ele('cas:proxyGrantingTicket', pgtId).up()
		.end({ pretty: true});
}

function failure({code, message}) {
	return xmlBuilder.create('cas:serviceResponse', {'xmlns:cas': 'http://www.yale.edu/tp/cas'})
		.ele('cas:authenticationFailure', { 'code': code }, message)
		.end({ pretty: true });
}

function proxySuccess(pgt) {
	return xmlBuilder.create('cas:serviceResponse', {'xmlns:cas': 'http://www.yale.edu/tp/cas'})
		.ele('cas:proxySuccess')
		.ele('cas:proxyTicket', pgt)
		.up().end({ pretty: true });
}

function proxyFailure({code, message}) {
	return xmlBuilder.create('cas:serviceResponse', {'xmlns:cas': 'http://www.yale.edu/tp/cas'})
		.ele('cas:proxyFailure', { 'code': code }, message)
		.end({ pretty: true });
}

module.exports = {
	serviceResponse: {
		success: success,
		failure: failure,
		proxySuccess: proxySuccess,
		proxyFailure: proxyFailure
	},

};