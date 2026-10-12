// Prepared parts for experimental_composeSpec: app-owned element recipes; the evaluator only picks/arranges.
export const candidates = [
  { id: 'page', description: 'A page: a vertical stack holding everything else', element: { type: 'Stack', props: { direction: 'vertical' } } },
  { id: 'row', description: 'A row: a horizontal stack that puts its children side by side', root: false, maxUses: 2, element: { type: 'Stack', props: { direction: 'horizontal' } } },
  { id: 'revenue', description: "KPI: this month's revenue ($48.2k)", root: false, element: { type: 'Metric', props: { label: 'Revenue', value: '$48.2k' } } },
  { id: 'signups', description: 'KPI: new signups this week (312)', root: false, element: { type: 'Metric', props: { label: 'Signups', value: '312' } } },
  { id: 'churn', description: 'KPI: customer churn this month (2.1%)', root: false, element: { type: 'Metric', props: { label: 'Churn', value: '2.1%' } } },
  { id: 'weather', description: "Text: today's weather forecast for the office city", root: false, element: { type: 'Text', props: { text: 'Honolulu: 27°C, trade winds, passing showers' } } },
  { id: 'feedbackCard', description: 'A card titled "Send feedback" that holds the feedback field and its send button', element: { type: 'Card', props: { title: 'Send feedback' } } },
  { id: 'feedbackField', description: 'Text field for the feedback message', root: false, element: { type: 'TextInput', props: { label: 'Message', value: { $bindState: '/feedback/message' } } } },
  {
    id: 'feedbackSend', description: 'Button that sends the feedback message', root: false,
    element: { type: 'Button', props: { label: 'Send' }, on: { press: [
      { action: 'submitFeedback', params: { message: { $state: '/feedback/message' } } },
      { action: 'setState', params: { statePath: '/feedback/message', value: '' } },
    ] } },
  },
]
export const initialState = { feedback: { message: '' } }
