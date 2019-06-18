const LRU = require('lru-cache');
const os = require('os');
const randExp = require('randexp');

const DEAFULT_MAX_SERVICE_TICKET_LIFE = 60 * 1000; // 10s
const DEFAULT_MAX_TICKET_GRANTING_TICKET_LIFE = 8 * 60 * 60 * 1000; // 8h
const DEFAULT_TIME_TO_KILL_IN_SECOND = 2 * 60 * 60 * 1000; // 2h

const ticketBody = new randExp(/[a-zA-Z0-79]{24}/);

function DEFAULT_SUFFIX() {
	return os.hostname();
}

exports.Registry = function (options) {
	const {
		suffix = DEFAULT_SUFFIX,
		maxServiceTicketLife = DEAFULT_MAX_SERVICE_TICKET_LIFE,
		maxTicketGrantingTicketLife = DEFAULT_MAX_TICKET_GRANTING_TICKET_LIFE,
		timeToKillInSecond = DEFAULT_TIME_TO_KILL_IN_SECOND
	} = options;

	const counter = { st: 1, tgt: 1 };
	const store = {
		tgt: new LRU({
			maxAge: timeToKillInSecond,
			updateAgeOnGet: true
		}),
		st: new LRU({
			maxAge: maxServiceTicketLife
		})
	};

	function TicketId(prefix, counterKey) {
		return `${prefix}-${counter[counterKey]++}-${ticketBody.gen()}-${suffix()}`;
	}

	function ServiceTicket(tgt) {
		const isPt = tgt.parent !== null;

		return {
			id: TicketId(isPt ? 'PT' : 'ST', 'st'),
			tgtId: tgt.id
		};
	}

	function TicketGrantingTicket(serviceName, principal, parentTgtId = null) {
		const isPgt = parentTgtId !== null;

		return {
			id: TicketId(isPgt ? 'PGT' : 'TGT', 'tgt'),
			parent: parentTgtId,
			serviceName,
			createAt: Date.now(),
			stIdList: [],
			pgtIdList: [],
			principal
		};
	}

	function collectionService(ticketId, list) {
		const tgt = store.tgt.get(ticketId);
		list.push(tgt.serviceName);
		console.log(tgt);

		if (tgt.stIdList) {
			tgt.stIdList.forEach(stId => {
				console.log(store.st.get(stId));
				list.push(store.st.get(stId).serviceName);
			});
		}

		if (!tgt.pgtIdList) {
			return list;
		} else {
			tgt.pgtIdList.forEach(pgtId => {
				return collectionService(pgtId, list);
			});
		}
	}

	return {
		tgt: {
			create(serviceName, principal, stId = null) {
				if (stId === null) {
					const tgt = TicketGrantingTicket(serviceName, principal);
					store.tgt.set(tgt.id, tgt);

					return tgt;
				}

				const st = store.st.get(stId).st;

				if (!st) {
					throw new Error('');
				}

				const pgt = TicketGrantingTicket(serviceName, principal, st.tgtId);
				const parentTgt = store.tgt.get(st.tgtId);

				store.tgt.set(pgt.id, pgt);
				parentTgt.pgtIdList.push(pgt.id);

				return pgt;
			},
			remove(id) {
				const list = [];
				collectionService(id, list);

				store.tgt.del(id);

				return list;
			},
			get(id) {
				return store.tgt.get(id);
			}
		},
		st: {
			create(tgtId, serviceName) {
				if (!store.tgt.has(tgtId)) {
					throw new Error('');
				}

				const tgt = store.tgt.get(tgtId);
				const st = ServiceTicket(tgt);

				store.st.set(st.id, { st, serviceName });

				return st;
			},
			get(id) {
				return store.st.get(id).st;
			},
			validate(id) {
				const { st } = store.st.get(id);

				if (st) {
					store.tgt.get(st.tgtId).stIdList.push(st.id);
					return true;
				}

				return false;
			}
		}
	};
};