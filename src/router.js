const Router = require('koa-router');
const { URL } = require('url');
const xml = require('./xml');
const LRU = require('lru-cache');
const axios = require('axios');

const localDomainToIp = /localhost/;

const errorCodeList = {
	INVALID_REQUESET: {
		code: 'INVALID_REQUEST',
		message: 'Not all of the required request parameters were present.'
	},
	INVALID_TICKET_SPEC: {
		code: 'INVALID_TICKET_SPEC',
		message: 'Failure to meet the requirements of validation sepecification.'
	},
	UNAUTHORIZED_SERVICE_PROXY: {
		code: 'UNAUTHORIZED_SERVICE_PROXY',
		message: 'The service in not authorized to perform proxy authentication.'
	},
	INVALID_PROXY_CALLBACK: {
		code: 'INVALID_PROXY_CALLBACK',
		message: 'The proxy callback specified is invalid.'
	},
	INVALID_TICKET: {
		code: 'INVALID_TICKET',
		message: 'The ticket provided was not valid.'
	},
	INVALID_SERVICE: {
		code: 'INVALID_SERVICE',
		message: 'The ticket provided was valid, but the service specified did not match the service associated with the ticket. '
	},
	INTERNAL_ERROR: {
		code: 'INTERNAL_ERROR',
		message: 'An internal error occurred during ticket validation.'
	},
	BAD_PGT: {
		code: 'BAD_PGT',
		message: 'The Proxy Granting Ticket invalid.'
	},
};

const ticketResponseTypeMap = {
	json: function (serviceTicket, principal, ctx) {
		ctx.status = 200;
		ctx.type = 'application/json';
		ctx.registry.ticket.ticketGrantingTicket.validatedServiceTicket(serviceTicket.id);
		ctx.body = {
			id: principal.id,
			attributes: principal,
			proxyGrantingTicket: serviceTicket,
			serviceTicket
		};
	},
	xml: function (serviceTicket, principal, ctx) {
		ctx.status = 200;
		ctx.type = 'text/xml';
		ctx.registry.ticket.ticketGrantingTicket.st.validate(serviceTicket.id);
		ctx.body = xml.serviceResponse.success(principal.id, principal.attributes, serviceTicket.id);
	}
};

const loginResponseTypeMap = {
	json: function (loginTicket, service, ctx) {
		return ctx.redirect(service || '');
	},
	html: function (loginTicket, service, ctx) {
		if (!loginTicket || loginTicket.validated) {
			return ctx.throw(400, errorCodeList.INVALID_TICKET);
		}

		if (!service) {
			return ctx.redirect(ctx.href);
		}

		ctx.status = 302;
		ctx.redirect(service);
	}
};

const pgtIouStore = new LRU({
	maxAge: 8 * 60 * 60 * 1000
});

function genPgtIouId() {

	return 'PGTIOU-'+ Math.random().toString(16).substr(2, 8)
		+ '-' + Math.random().toString(16).substr(2, 8) 
		+ '-' + Math.random().toString(16).substr(2, 8);
}
function PgtIou() {
	return {
		create(pgtId) {
			const pgtIou = {
				id:genPgtIouId(),
				pgtId: pgtId
			};
			pgtIouStore[pgtIou] = pgtIou;
			return pgtIou;
		},
		get(id) {
			return pgtIouStore[id];
		}
	};
}

const PREFIX_REG = /^\/[a-z0-9A-Z_-]+/;

module.exports = function createRouter(prefix = '/cas') {
	if (!PREFIX_REG.test(prefix)) {
		throw new Error('Invalid prefix stirng. e.g. `/cas`');
	}

	return new Router({
		prefix
	}).post('/login', async ctx => {
		const { execution: loginTicketId } = ctx.request.body;

		const { service } = ctx.query;
		const serviceUrl = localDomainToIp.test(service) ? domainToIp(service) : service;
		const tgc = ctx.cookies.get('CASTGC');
		var serviceTicket;
		var redirectUrl;

		if (!tgc) {
			try {
				const loginTicket = await ctx.registry.ticket.login.get(loginTicketId);

				if (!loginTicket || loginTicket.validated) {
					return ctx.redirect('/');
				}

				await ctx.registry.ticket.login.validate(loginTicketId);
				
			} catch (error) {
				ctx.throw(400, 'Invalidate login parameters');
			}
			
			const { user, attributes } = await ctx.options.authenticateAccount(ctx.request.body, ctx);
			attributes.authenticationDate = new Date();
			const ticketGrantingTicket = await ctx.registry.ticket.ticketGrantingTicket.tgt.create(serviceUrl, genPrincipal(user, attributes));

			ctx.cookies.set('CASTGC', ticketGrantingTicket.id);

			if (serviceUrl) {
				await ctx.options.validateService(serviceUrl);

				serviceTicket = await ctx.registry.ticket.ticketGrantingTicket.st.create(ticketGrantingTicket.id, serviceUrl);

				redirectUrl = serviceUrl + '?ticket=' + serviceTicket.id;

				return ctx.redirect(redirectUrl);
			}
		} else {
			const exsitedTicketGrantingTicket = await ctx.registry.ticket.ticketGrantingTicket.tgt.get(tgc);

			if (!exsitedTicketGrantingTicket) {
				await ctx.registry.ticket.login.validate(loginTicketId);

				return ctx.throw(403, 'The ticket granting ticket has expired.');
			} else {
				try {
					serviceTicket = await ctx.registry.ticket.ticketGrantingTicket.st.create(tgc, service);

					redirectUrl = serviceUrl + '?ticket=' + serviceTicket.id;
					return ctx.redirect(redirectUrl);

				} catch (error) {
					ctx.throw(500, error);
				}
			}
		}
	}).get('/login', async ctx => {
		var serviceUrl = ctx.query.service;
		const { renew, gateway } = ctx.query;
		const tgc = ctx.cookies.get('CASTCG');

		if (renew && gateway) {
			ctx.throw(400, 'The parameter renew and gateway cannot be set at the same time.');
		}

		if (serviceUrl !== undefined) {
			try {
				serviceUrl = new URL(serviceUrl);
			} catch (error) {
				ctx.throw(400, 'service is not a url');
			}
		}

		if (tgc || renew) {
			const serviceTicket = await ctx.registry.ticket.ticketGrantingTicket.st.create(tgc);

			return ctx.redirect(serviceUrl + '?ticket=' + serviceTicket.id);
		}

		if (gateway) {
			return ctx.redirect(ctx.href);
		}

		try {
			await ctx.options.validateService(serviceUrl);
		} catch (error) {
			return ctx.throw(500, error);
		}

		const loginTicket = await ctx.registry.ticket.login.create();
		//TODO remember to delete this
		console.log(ctx.registry.ticket.login.getList());

		ctx.body = loginResponseTypeMap[ctx.options.loginType](loginTicket, serviceUrl, ctx);
	}).get('/logout', async ctx => {
		const tgc = ctx.cookies.get('CASTGC');
		const { service } = ctx.query;
		ctx.cookies.set('CASTGC', null);

		const serviceList = await ctx.registry.ticket.ticketGrantingTicket.tgt.remove(tgc);

		ctx.redirect(service || '/login');
	}).get('/serviceValidate', async ctx => {
		return serviceValidation(ctx);
	}).get('/proxyValidate', async ctx => {
		const { service } = ctx.query;
		const serviceUrl = fliterJsessionId(service);
		const { ticket: serviceTicketId, pgtUrl }= ctx.query;
		const tgt = await ctx.registry.ticket.ticketGrantingTicket.st.get(serviceTicketId).tgtId;

		const renew = ctx.query.renew && (ctx.query.renew === 'true' || ctx.query.renew);

		const { principal } = await ctx.registry.ticket.ticketGrantingTicket.tgt.get(tgt);

		if (pgtUrl) {
			try {
				const proxyGrantingTicket = await ctx.registry.ticket.ticketGrantingTicket.tgt.create(serviceUrl, principal, serviceTicketId);
				const pgtIou = PgtIou().create(proxyGrantingTicket);

				await axios.get(pgtUrl, {
					params: {
						pgtId: proxyGrantingTicket.id,
						pgtIou: pgtIou.id
					}
				});

				return ctx.body = xml.serviceResponse.success(principal.id, principal.attributes, pgtIou.id);
			} catch (error) {
				ctx.throw(400);
				return xml.serviceResponse.failure({
					code: errorCodeList.INVALID_TICKET,
					message: `Ticket ${serviceTicketId} not recognized`
				});
			}
		}

		if (renew && principal) {
			ctx.status = 200;
			ctx.type = 'text/xml';
			ctx.body = xml.serviceResponse.success(principal.id, principal.attributes, serviceTicketId);
		} else if (renew && !principal) {
			ctx.throw(400);
			return xml.serviceResponse.failure(errorCodeList.INVALID_TICKET);
		}

		try {
			const service = await ctx.options.validateService(serviceUrl);

			if (validateService(service).isError) {
				ctx.throw(400);
				return xml.serviceResponse.failure({ code: service.code, message: service.message });
			}
		} catch (error) {
			return xml.serviceResponse.failure({
				code: errorCodeList.INTERNAL_ERROR,
				message: `Ticket ${serviceTicketId} not recognized.`
			});
		}

		try {
			const serviceTicket = await ctx.registry.ticket.ticketGrantingTicket.st.get(serviceTicketId);

			if (validateServcieTicket(serviceTicket).isError) {
				ctx.throw(400);
				return xml.serviceResponse.failure({
					code: errorCodeList.INVALID_TICKET.code,
					message: `Ticket ${serviceTicketId} not recognized.`
				});
			}

			await ctx.registry.ticket.ticketGrantingTicket.st.validate(serviceTicket.id);

			return ticketResponseTypeMap[ctx.options.contentType](serviceTicket, principal, ctx);
		} catch (error) {
			return ctx.body = xml.serviceResponse.failure({
				code: errorCodeList.INTERNAL_ERROR.code,
				message: `Ticket ${serviceTicketId} not recognized`
			});
		}
	}).get('/p3/serviceValidate', async ctx => {
		serviceValidation(ctx);
	}).get('/p3/proxyValidate', async ctx => {
		const { service } = ctx.query;
		const serviceUrl = fliterJsessionId(service);
		const { ticket: serviceTicketId, pgtUrl }= ctx.query;
		const tgt = await ctx.registry.ticket.ticketGrantingTicket.st.get(serviceTicketId).tgtId;

		const renew = ctx.query.renew && (ctx.query.renew === 'true' || ctx.query.renew);

		const { principal } = await ctx.registry.ticket.ticketGrantingTicket.tgt.get(tgt);

		if (pgtUrl) {
			try {
				const proxyGrantingTicket = await ctx.registry.ticket.ticketGrantingTicket.tgt.create(serviceUrl, principal, serviceTicketId);
				const pgtIou = PgtIou().create(proxyGrantingTicket);

				await axios.get(pgtUrl, {
					params: {
						pgtId: proxyGrantingTicket.id,
						pgtIou: pgtIou.id
					}
				});

				return ctx.body = xml.serviceResponse.success(principal.id, principal.attributes, pgtIou.id);
			} catch (error) {
				ctx.throw(400);
				return xml.serviceResponse.failure({
					code: errorCodeList.INVALID_TICKET,
					message: `Ticket ${serviceTicketId} not recognized`
				});
			}
		}

		if (renew && principal) {
			ctx.status = 200;
			ctx.type = 'text/xml';
			ctx.body = xml.serviceResponse.success(principal.id, principal.attributes, serviceTicketId);
		} else if (renew && !principal) {
			ctx.throw(400);
			return xml.serviceResponse.failure(errorCodeList.INVALID_TICKET);
		}

		try {
			const service = await ctx.options.validateService(serviceUrl);

			if (validateService(service).isError) {
				ctx.throw(400);
				return xml.serviceResponse.failure({ code: service.code, message: service.message });
			}
		} catch (error) {
			return xml.serviceResponse.failure({
				code: errorCodeList.INTERNAL_ERROR,
				message: `Ticket ${serviceTicketId} not recognized.`
			});
		}

		try {
			const serviceTicket = await ctx.registry.ticket.ticketGrantingTicket.st.get(serviceTicketId);

			if (validateServcieTicket(serviceTicket).isError) {
				ctx.throw(400);
				return xml.serviceResponse.failure({
					code: errorCodeList.INVALID_TICKET.code,
					message: `Ticket ${serviceTicketId} not recognized.`
				});
			}

			await ctx.registry.ticket.ticketGrantingTicket.st.validate(serviceTicket.id);

			return ticketResponseTypeMap[ctx.options.contentType](serviceTicket, principal, ctx);
		} catch (error) {
			return ctx.body = xml.serviceResponse.failure({
				code: errorCodeList.INTERNAL_ERROR.code,
				message: `Ticket ${serviceTicketId} not recognized`
			});
		}
	}).get('/proxy', async ctx => {
		const { pgt, targetService } = ctx.query;

		try {
			const proxyTicket = await ctx.registry.ticket.ticketGrantingTicket.st.create(pgt, targetService);
			
			ctx.type = 'text/xml';
			ctx.body = xml.serviceResponse.proxySuccess(proxyTicket.id);
		} catch (error) {

			return xml.serviceResponse.proxyFailure({
				code: errorCodeList.INVALID_REQUESET,
				message: 'pgt and targetService parameters are both required.'
			});
		}
	});
};


function validateService(service) {
	if (!service) {
		return localError(
			errorCodeList.INVALID_SERVICE.code,
			errorCodeList.INVALID_SERVICE.message,
		);
	}

	return service;
}

function localError(code, message) {
	const error = Error(message);
	Object.defineProperties(error, {
		code: code,
		isError: true
	});

	return error;
}

function validateServcieTicket(serviceTicket) {
	if (serviceTicket) {
		return true;
	}

	return localError(errorCodeList.INVALID_TICKET.code, 'service ticket expired');
}

function genPrincipal(user, attributes) {
	attributes.username = user;
	return {
		id: user,
		attributes
	};
}

function domainToIp(domain) {
	return domain.replace(localDomainToIp, '127.0.0.1');
}

function fliterJsessionId(url) {
	if (url.indexOf(';')) {
		return url.substring(0, url.indexOf(';'));
	}

	return url;
}

async function serviceValidation(ctx) {
	const { service } = ctx.query;
	const serviceUrl = fliterJsessionId(service);
	const serviceTicketId = ctx.query.ticket;
	const tgt = await ctx.registry.ticket.ticketGrantingTicket.st.get(serviceTicketId).tgtId;

	const renew = ctx.query.renew && (ctx.query.renew === 'true' || ctx.query.renew);

	const principal = await ctx.registry.ticket.ticketGrantingTicket.tgt.get(tgt).principal;
	if (renew && principal) {
		ctx.status = 200;
		ctx.type = 'text/xml';
		ctx.body = xml.serviceResponse.success(principal.id, principal.attributes, serviceTicketId);
	} else if (renew && !principal) {
		ctx.throw(400);
		return xml.serviceResponse.failure(errorCodeList.INVALID_TICKET);
	}

	try {
		const service = await ctx.options.validateService(serviceUrl);

		if (validateService(service).isError) {
			ctx.throw(400);
			return xml.serviceResponse.failure({ code: service.code, message: service.message });
		}
	} catch (error) {
		return xml.serviceResponse.failure(errorCodeList.INTERNAL_ERROR);
	}

	try {
		const serviceTicket = await ctx.registry.ticket.ticketGrantingTicket.st.get(serviceTicketId);

		if (validateServcieTicket(serviceTicket).isError) {
			ctx.throw(400);
			return xml.serviceResponse.failure({
				code: errorCodeList.INVALID_TICKET.code,
				message: `Ticket ${serviceTicketId} not recognized`
			});
		}

		return ticketResponseTypeMap[ctx.options.contentType](serviceTicket, principal, ctx);
	} catch (error) {
		return ctx.body = xml.serviceResponse.failure({
			code: errorCodeList.INTERNAL_ERROR.code,
			message: `Ticket ${serviceTicketId} not recognized`
		});
	}

}