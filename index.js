const Koa = require('koa');
const bodyparser = require('koa-bodyparser');
const router = require('./src/router');
const store = require('./src/ticket/store');
const memoryRegistry = require('./memoryRegistry');

function BASIC_AUTHENTICATE_ACCOUNT(reqestBody) {
	const loginInfo = {
		user: reqestBody.username,
		attributes: {
			authenticationDate: null
		}
	};

	return loginInfo;
}

function BASIC_VALIDATE_SERVICE(service) {
	return true;
}


exports.createServer = function Server(options = {}) {
	const {
		validateService = BASIC_VALIDATE_SERVICE,
		authenticateAccount = BASIC_AUTHENTICATE_ACCOUNT,
		contentType = 'xml',
		loginType = 'html',
		registryOptions = {
			maxServiceTicketLife: null,
			maxTicketGrantingTicketLife: null,
			timeToKillInSecond: null,
			ticketRegistry: null
		},
		routerOptions = {
			prefix: '/cas',
			tgcName: 'CASTGC'
		}
	} = options;

	if (!registryOptions.ticketRegistry) {
		registryOptions.ticketRegistry = memoryRegistry.createMemoryRegistry();
	}

	const registry = store.Registry(registryOptions);

	const app = new Koa();

	app.context.registry = {
		ticket: {
			tgt: registry.tgt,
			st: registry.st
		}
	};

	app.context.options = {
		contentType, loginType,
		validateService, authenticateAccount,
	};

	return app.use(bodyparser()).use(router(routerOptions).routes());
};