const xmlBuilder = require('xmlbuilder');

exports.serviceResponse = {
	authenticationSuccess: function (user, attributes, pgtId, proxies = null) {
		const xml = xmlBuilder.create('cas:serviceResponse', { 'xmlns:cas': 'http://www.yale.edu/tp/cas' })
			.att('xmlns:cas', 'http://www.yale.edu/tp/cas')
			.ele('cas:authenticationSuccess').ele('cas:user', user).up();

		const attributesNode = xmlBuilder.create('cas:attributes');

		if (attributes) {
			Object.keys(attributes).forEach(item => {
				attributesNode.ele(`cas:${item}`, attributes[item]);
			});

			xml.importDocument(attributesNode);
		}

		xml.ele('cas:proxyGrantingTicket', pgtId);

		const proxyNode = xmlBuilder.create('cas:proxies');

		if (proxies) {
			proxies.forEach(proxy => {
				proxyNode.ele('cas:proxy', proxy);
			});

			xml.importDocument(proxyNode);
		}

		return xml.end({ pretty: true });
	},
	authenticationFailure: function (code, message) {
		return xmlBuilder.create('cas:serviceResponse', { 'xmlns:cas': 'http://www.yale.edu/tp/cas' })
			.ele('cas:authenticationFailure', { 'code': code }, message)
			.end({ pretty: true });
	},
	proxySuccess: function (pgtId) {
		return xmlBuilder.create('cas:serviceResponse', { 'xmlns:cas': 'http://www.yale.edu/tp/cas' })
			.ele('cas:proxySuccess')
			.ele('cas:proxyTicket', pgtId)
			.up().end({ pretty: true });
	},
	proxyFailure: function (code, message) {
		return xmlBuilder.create('cas:serviceResponse', { 'xmlns:cas': 'http://www.yale.edu/tp/cas' })
			.ele('cas:proxyFailure', { 'code': code }, message)
			.end({ pretty: true });
	}
};