const Koa = require('koa');
const bodyparser = require('koa-bodyparser');
const router = require('./src/router');
const registry = require('./src/store');
const LRU = require('lru-cache');

function BASIC_AUTHENTICATE_ACCOUNT(reqestBody) {
	const loginInfo = {
		user: reqestBody.username,
		attributes: {
			// credentialType: 'UsernameAndPasswordCredential',
			authenticationDate: null
		}
	};

	return loginInfo;
}

function BASIC_VALIDATE_SERVICE(service) {
	return true;
}

var ltCounter = 1;

function genLoginTicketId() {

	return 'LT-'+ (ltCounter++) + '-' + Math.random().toString(16).substr(2, 8)
		+ '-' + Math.random().toString(16).substr(2, 8) 
		+ '-' + Math.random().toString(16).substr(2, 8);
}

function LoginTicket() {
	return {
		id: genLoginTicketId(),
		createdAt: Date.now(),
		validated: false
	};
}

function LoginTicketRegistry() {
	const ltStore = new LRU({ 
		max: 50, 
		maxAge: 5 * 60 * 1000,
		updateAgeOnGet: true
	});

	setInterval(function LoginTicketExpirationPolicy(){
		ltStore.forEach((value, key) => {
			if (value.validated) {
				ltStore.del(key);
			}
		}); 

		ltStore.prune();
	}, 5 * 60 * 1000);
	
	return {
		create() {
			const lt = LoginTicket();
			ltStore.set(lt.id, lt);

			return ltStore.get(lt.id);
		},
		get(id) {
			// return ltStore.get(id);
			return true;
		},
		validate(id) {
			// if (ltStore.has(id)) {
			// 	const lt = ltStore.get(id);
			// 	lt.validated = true;
			// 	ltStore.set(lt.id, lt);

			// 	return true;
			// }

			// return false;
			return true;
		}
	};
}

const TICKET_GRANTING_TICKET_EXPIRATION_POLICY = {
	MAX_TICKET_GRANTING_TICKET_LIFE: 8 * 60 * 60 * 1000,
	TIME_TO_KILL_IN_SECOND: 2 * 60 * 60 * 1000
};

exports.createServer = function Server(options = {}) {
	const {
		ticketRegistry = {
			login: null,
			ticketGrantingTicket: null
		},
		ticketGrantingTicketExpirationPolicy = TICKET_GRANTING_TICKET_EXPIRATION_POLICY,
		serviceRegistry = null,
		validateService = BASIC_VALIDATE_SERVICE,
		authenticateAccount = BASIC_AUTHENTICATE_ACCOUNT,
		contentType = 'xml',
		loginType = 'html'
	} = options;
	
	if (ticketRegistry !== null) {
		if (!validTicketRegistry(ticketRegistry)) {
			throw Error(400, 'Incorrect ticket registry format.');
		}
	} 
	
	if (serviceRegistry !== null) {
		if(!isObject(serviceRegistry)) {
			throw Error(400, 'Incorrect service registry format.');
		} 
	}

	if (validateService !== BASIC_VALIDATE_SERVICE) {
		if (typeof validateService !== 'function') {
			throw Error(400, 'Incorrect validate service function.');
		}
	}

	const app = new Koa();
	
	app.context.registry = {
		ticket: {
			login: ticketRegistry.login || LoginTicketRegistry(),
			ticketGrantingTicket: ticketRegistry.ticketGrantingTicket || registry.Registry(options),
		}
	};

	app.context.options = { 
		contentType, loginType, 
		validateService, authenticateAccount, 
		ticketGrantingTicketExpirationPolicy 
	};

	return app.use(bodyparser()).use(router().routes());
};

function validTicketRegistry(ticketRegistry) {
	if (isObject(ticketRegistry) 
		&& 'login' in ticketRegistry
		&& 'ticketGrantingTicket' in ticketRegistry ) {
			
		if(isObject(ticketRegistry.login) && isObject(ticketRegistry.ticketGrantingTicket)) {
			return true;
		}
	}

	return false;
}

function isObject(any) {
	return typeof any === 'object';
} 