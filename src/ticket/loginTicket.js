const randExp = require('randexp');
const ticketBody = new randExp(/[a-zA-Z0-9]{24}/);

const DEFAULT_LOGIN_TICKET_LIFE = 5 * 60 * 1000; //5 min

exports.LoginTicketStore = function () {
	const ltStore = {};
	let counter = 1;

	function genTicketId() {
		return 'LT-' + counter++ + '-' +  ticketBody.gen();
	}

	function LoginTicket() {
		return {
			id: genTicketId(),
			createdAt: Date.now(),
			validated: false
		};
	}

	setInterval(function invalidTicketCleaner() {
		Object.keys(ltStore).forEach(ltId => {
			if (ltStore[ltId].validated 
				|| ltStore[ltId].createdAt > Date.now() - DEFAULT_LOGIN_TICKET_LIFE) {
				delete ltStore[ltId];
			}
		});
	}, 5 * 60 * 1000);

	return {
		create() {
			const lt = LoginTicket();

			ltStore[lt.id] = lt;

			return lt;
		},
		get(id) {
			return ltStore[id];
		},
		validate(id) {
			const lt = ltStore[id];

			if (!lt) {
				return null;
			}

			if (lt.validated) {
				return false;
			}

			lt.validated = true;
			ltStore[lt.id] = lt;
		}
	};
};