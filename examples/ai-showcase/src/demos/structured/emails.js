// Sample emails, messy on purpose: forwarded threads, signatures, changes of plan, relative
// dates ("next Thursday") that only resolve against today's date.
export const EMAILS = [
  {
    label: 'Kickoff, rescheduled',
    text: `Fwd: Re: Re: kickoff??

---------- Forwarded message ---------
From: Priya Raman <priya.raman@northwind.io>
To: Dev Team

hey all — sorry for the back and forth. Tuesday doesn't work for Marco anymore so let's move the Atlas kickoff to NEXT THURSDAY, 2pm, same room (4th floor, "Fjord"). Plan for 90 min, it's a big one.

Marco Bellini (marco@northwind.io) and Lena Okafor have to be there. Sam (sam.t@northwind.io) — join if you can, no pressure.

What we'll cover:
- scope + what's out for v1
- who owns the API migration
- timeline to the March beta

This is the one Dana (our VP) asked about, so please don't skip it!!

thx
P.

Sent from my phone, excuse typos`,
  },
  {
    label: 'Call across time zones',
    text: `Subject: Quick sync w/ Berlin team

Hi Jordan,

Can we grab 30 minutes with Anke and Tobias on Friday? They're in Berlin so mornings for us are best — let's say 8:30 AM Pacific (that's 5:30 PM for them).

Zoom: https://zoom.us/j/8812345678 (pw in the invite)

Agenda is just the localization handoff and whether the German copy is final.

Anke's email is anke.vogel@kaffee-labs.de if you want to cc her. Tobias is optional, he's mostly on the design side.

Cheers,
Rosa Delgado
Product Lead`,
  },
  {
    label: 'Dinner thread',
    text: `RE: dinner?? 🍝

Mia: ok so are we doing saturday or sunday
Theo: saturday!! sunday I have my sister's thing
Mia: saturday it is. my place, 7:30. 14 Alder Lane, buzzer 3B
Theo: should I bring anything
Mia: wine + maybe that lemon tart?? Jun is making the pasta. Ella said she might come late, maybe
Theo: perfect. runs till like 11 knowing us 😂`,
  },
  {
    label: 'Talk accepted',
    text: `Subject: [ReactiveConf] Your talk has been accepted 🎉

Dear Alex Kim,

Congratulations! Your talk "Streams All the Way Down: MVI in Practice" has been accepted for ReactiveConf.

Your slot: Day 2, the 15th of next month, 11:15–11:45 (CET), Main Hall, Prague Congress Centre, 5. května 65, Prague.

Please send your final slides to speakers@reactiveconf.example by the 10th, and confirm the A/V check at 10:30 the same morning with our stage manager, Petra Novak.

We look forward to seeing you there!

The ReactiveConf Program Committee`,
  },
]
