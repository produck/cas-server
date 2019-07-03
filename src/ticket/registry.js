const randExp = require('randexp');
const ticketBody = new randExp(/[a-z0-9A-Z]{24}/);

const DEFAULT_LOGIN_TICKET_TIME_TO_KILL_IN_SECONDS = 300000;

exports.Registry = function (options) {
	const { suffix, registryMethods, tgt, st } = options;

	const counter = { st: 1, tgt: 1, lt: 1 };

	function TicketId(prefix, counterKey) {
		return `${prefix}-${counter[counterKey]++}-${ticketBody.gen()}-${suffix}`;
	}

	function ServiceTicket(tgt, serviceName) {
		const isPt = tgt.parent !== null;

		return {
			id: TicketId(isPt ? 'PT' : 'ST', 'st'),
			tgtId: tgt.id,
			createdAt: Date.now(),
			validated: false,
			serviceName
		};
	}

	function TicketGrantingTicket(principal, parentTgtId = null) {
		const isPgt = parentTgtId !== null;

		return {
			id: TicketId(isPgt ? 'PGT' : 'TGT', 'tgt'),
			parent: parentTgtId,
			createdAt: Date.now(),
			stIdList: [],
			pgtIdList: [],
			principal
		};
	}

	function LoginTicket() {
		return {
			id: TicketId('LT', 'lt'),
			createdAt: Date.now(),
			validated: false
		};
	}

	function validateTgt(ticketGrantingTicket, life = tgt.maxTimeToLiveInSeconds) {
		if (!ticketGrantingTicket || !ticketGrantingTicket.id || !ticketGrantingTicket.createdAt || !ticketGrantingTicket.principal) {
			return false;
		}

		if (ticketGrantingTicket.createdAt < Date.now() - life && st.validated) {
			return false;
		}

		return true;
	}

	function validateSt(serviceTicket, life = st.timeToKillInSeconds) {
		if (!serviceTicket || !serviceTicket.id || !serviceTicket.tgtId || !serviceTicket.serviceName) {
			return false;
		}

		if (serviceTicket.createdAt < Date.now() - life && st.validated) {
			return false;
		}

		return true;
	}

	function validateLt(loginTicket) {
		if (!loginTicket || !loginTicket.id) {
			return false;
		}

		if (loginTicket.validated && loginTicket.createdAt < Date.now() - DEFAULT_LOGIN_TICKET_TIME_TO_KILL_IN_SECONDS) {
			return false;
		}

		return true;
	}

	function collectService(tgtId, list) {
		const tgt = registryMethods.tgt.get(tgtId);
		list.push(tgt.serviceName);

		if (tgt.stIdlist !== null) {
			tgt.stIdlist.forEach(stId => {
				list.push(registryMethods.st.get(stId).serviceName);
			});
		}

		if (tgt.pgtIdList === null) {
			return list;
		} else {
			tgt.pgtIdList.forEach(pgtId => {
				return collectService(pgtId, list);
			});
		}
	}

	return {
		tgt: {
			create(principal, stId = null) {
				if (stId === null) {
					const tgt = TicketGrantingTicket(principal);
					registryMethods.tgt.set(tgt);

					return tgt;
				}

				const st = registryMethods.st.get(stId);
				if (!st) {
					throw new Error('The service ticket not exist.');
				}

				const pgt = TicketGrantingTicket(principal, st.tgtId);
				const parentTgt = registryMethods.tgt.get(st.tgtId);

				registryMethods.tgt.set(pgt);
				parentTgt.pgtIdList.push(pgt.id);

				return pgt;
			},
			get(id) {
				const tgt = registryMethods.tgt.get(id);

				if (!tgt || !validateTgt(tgt)) {
					return null;
				}

				return tgt;
			},
			remove(id) {
				const serviceList = [];
				collectService(id, serviceList);

				registryMethods.tgt.del(id);

				return serviceList;
			}
		},
		st: {
			create(tgtId, serviceName) {
				if (!registryMethods.tgt.get(tgtId)) {
					return new Error('The ticket granting ticket not exist.');
				}

				const tgt = registryMethods.tgt.get(tgtId);
				const st = ServiceTicket(tgt, serviceName);

				registryMethods.st.set(st);

				return st;
			},
			get(id) {
				const st = registryMethods.st.get(id);
				if (!validateSt(st)) {
					return null;
				}

				return st;
			},
			validate(id) {
				const st = registryMethods.st.get(id);

				if (validateSt(st)) {
					st.validated = true;

					registryMethods.st.set(st);
					registryMethods.tgt.get(st.tgtId).stIdList.push(st.id);

					return true;
				}

				return false;
			}
		},
		lt: {
			create() {
				const lt = LoginTicket();

				registryMethods.lt.set(lt);

				return lt;
			},
			get(ltId) {
				const lt = registryMethods.lt.get(ltId);
				if (!validateLt(lt)) {
					return null;
				}

				return lt;
			},
			validate(ltId) {
				const lt = registryMethods.lt.get(ltId);

				if (validateLt(lt)) {
					lt.validated = true;

					registryMethods.lt.set(lt);

					return true;
				}
				
				return false;
			}
		}
	};
};