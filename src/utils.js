exports.errorCodeList = {
	// rename errors
	INVALID_REQUESET: 'Not all of the required request parameters were present.',
	INVALID_TICKET_SPEC:  'Failure to meet the requirements of validation sepecification.',
	UNAUTHORIZED_SERVICE_PROXY: 'The service in not authorized to perform proxy authentication.',
	INVALID_PROXY_CALLBACK:'The proxy callback specified is invalid.',
	INVALID_TICKET: 'The ticket provided was not valid.',
	INVALID_SERVICE: 'The ticket provided was valid, but the service specified did not match the service associated with the ticket. ',
	INTERNAL_ERROR: 'An internal error occurred during ticket validation.',
	BAD_PGT: 'The Proxy Granting Ticket invalid.'
};