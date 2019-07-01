const memoryRegistry = require('../memoryRegistry');
const os = require('os');
const xmlBuilder = require('xmlbuilder');

const PREFIX_REG = /^\/[a-zA-Z0-9_-]+/;

module.exports = function mergeOptions(...optionsList) {
	const defaultOptions = DefaultOptionsFactory();

	optionsList.forEach(({
		serviceResistry,
		authn,
		ticket,
		tgc,
		serviceResponse,
		loginResponse
	}) => {
		defaultOptions.cas.serviceResponse = serviceResponse;
		defaultOptions.cas.loginResponse = loginResponse;
		defaultOptions.cas.serviceResistry = serviceResistry;
		defaultOptions.cas.authn = authn;

		if (ticket) {
			const {
				suffix = defaultOptions.cas.ticket.suffix,
				tgt = defaultOptions.cas.ticket.tgt,
				st = defaultOptions.cas.ticket.st,
				registryMethods = defaultOptions.cas.ticket.registryMethods
			} = ticket;

			defaultOptions.cas.ticket.suffix = suffix;
			defaultOptions.cas.ticket.tgt = tgt;
			defaultOptions.cas.ticket.st = st;
			defaultOptions.cas.ticket.registryMethods = registryMethods;
		}

		if (tgc) {
			const {
				path = defaultOptions.cas.tgc.path,
				name = defaultOptions.cas.tgc.name
			} = tgc;

			defaultOptions.cas.tgc.path = path;
			defaultOptions.cas.tgc.name = name;
		}
	});

	validateOptions(defaultOptions);

	return defaultOptions;
};

const validateOptionsRule = {
	cas: {
		serviceResistry(value) {
			return typeof value === 'function';
		},
		serviceResponse(value) {
			if (!value.authenticationSuccess || !value.authenticationFailure || !value.proxySuccess || !value.proxyFailure) {
				return false;
			}

			return true;
		},
		loginResponse(value) {
			return typeof value === 'function';
		},
		authn(value) {
			return typeof value === 'function';
		},
		tgc: {
			path(value) {
				if (!PREFIX_REG.test(value)) {
					return new Error('Invalid prefix string. e.g. `/cas`');
				}

				return true;
			},
			name: isString
		},
		ticket: {
			suffix: isString,
			tgt: {
				maxTimeToLiveInSeconds: isNumber,
				timeToKillInSeconds: isNumber
			},
			st: {
				timeToKillInSeconds: isNumber
			},
			registryMethods: {
				tgt: {
					get(value) {
						return typeof value === 'function';
					},
					set(value) {
						return typeof value === 'function';
					},
					del(value) {
						return typeof value === 'function';
					}
				},
				st: {
					get(value) {
						return typeof value === 'function';
					},
					set(value) {
						return typeof value === 'function';
					},
					del(value) {
						return typeof value === 'function';
					}
				}
			}
		}
	}
};

function validateOptions(options) {
	const nodePath = [];

	function validate(ruleNode, optionsNode) {
		Object.keys(ruleNode).forEach(item => {
			nodePath.push(item);

			const ruleValidator = ruleNode[item]; const optionsValue = optionsNode[item];

			if (typeof ruleValidator === 'object') {

				validate(ruleValidator, optionsValue);
			} else if (!ruleValidator(optionsValue)) {
				throw new Error(`Bad value at options.${nodePath.join('.')}`);
			}

			nodePath.pop();
		});
	}

	validate(validateOptionsRule, options);

	return true;
}

function BASIC_AUTHENTICATE_ACCOUNT(requestBody) {
	return {
		user: requestBody.username,
		attributes: {
			authenticate: null
		}
	};
}
function DEFAULT_SUFFIX() {
	return os.hostname();
}

function BASIC_VALIDATE_SERVICE(service) {
	return true;
}

function DefaultOptionsFactory() {
	const ticketRegistry = memoryRegistry.createMemoryRegistry();

	return {
		cas: {
			serviceResistry: BASIC_VALIDATE_SERVICE,
			authn: BASIC_AUTHENTICATE_ACCOUNT,
			ticket: {
				suffix: DEFAULT_SUFFIX(),
				registryMethods: {
					tgt: {
						get(id) {
							return ticketRegistry.tgt.get(id);
						},
						set(value) {
							return ticketRegistry.tgt.set(value);
						},
						del(id) {
							return ticketRegistry.tgt.del(id);
						}
					},
					st: {
						get(id) {
							return ticketRegistry.st.get(id);
						},
						set(value) {
							return ticketRegistry.st.set(value);
						},
						del(id) {
							return ticketRegistry.st.del(id);
						}
					}
				},
				tgt: {
					maxTimeToLiveInSeconds: 28800000,
					timeToKillInSeconds: 7200000
				},
				st: {
					timeToKillInSeconds: 10000
				}
			},
			tgc: {
				path: '/cas',
				name: 'CASTGC'
			},
			serviceResponse: {
				authenticationSuccess(user, attributes, pgtId, proxies = null) {
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
				authenticationFailure(code, message) {
					return xmlBuilder.create('cas:serviceResponse', { 'xmlns:cas': 'http://www.yale.edu/tp/cas' })
						.ele('cas:authenticationFailure', { 'code': code }, message)
						.end({ pretty: true });
				},
				proxySuccess(pgtId) {
					return xmlBuilder.create('cas:serviceResponse', { 'xmlns:cas': 'http://www.yale.edu/tp/cas' })
						.ele('cas:proxySuccess')
						.ele('cas:proxyTicket', pgtId)
						.up().end({ pretty: true });
				},
				proxyFailure(code, message) {
					return xmlBuilder.create('cas:serviceResponse', { 'xmlns:cas': 'http://www.yale.edu/tp/cas' })
						.ele('cas:proxyFailure', { 'code': code }, message)
						.end({ pretty: true });
				}
			},
			loginResponse(url, ltId) {
				return `<form method="POST" action=${url}>
						username: <input type="test" name="username">
						password: <input type="password" name="password">
						<input type="hidden" name="execution" value=${ltId}>
						<input type="submit" name="password">
					</form>`;
			},
		}
	};
}

function isNumber(any) {
	return typeof any === 'number';
}

function isString(any) {
	return typeof any === 'string';
}