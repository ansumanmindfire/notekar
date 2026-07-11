const AB_TICKET_PATTERN = /AB#\d+/;
const TICKETED_TYPES = new Set(['feat', 'fix']);

const abTicketReference = (parsed) => {
  const { type, header, body, footer } = parsed;

  if (!TICKETED_TYPES.has(type)) {
    return [true];
  }

  const hasTicket =
    AB_TICKET_PATTERN.test(header ?? '') ||
    AB_TICKET_PATTERN.test(body ?? '') ||
    AB_TICKET_PATTERN.test(footer ?? '');

  return [hasTicket, 'feat/fix commits must reference a ticket as AB#xxxx'];
};

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'ab-ticket-reference': abTicketReference,
      },
    },
  ],
  rules: {
    'ab-ticket-reference': [2, 'always'],
  },
};
