Add a Courses page to this learning portal.

- Add a third tab, "Courses", after "Profile" in the `nav.tabs` bar. Like the other tabs it is a `button` that gets the class `active` while its page is shown.
- The courses come from `GET /api/courses`, which responds with JSON like:

  ```json
  { "courses": [{ "id": 1, "title": "Intro to Rust", "seats": 3 }] }
  ```

  `seats` is the number of free places. Send this request the first time the Courses page is opened, not at startup. Once it has been sent, don't send it again (even if the user leaves the page and comes back, or leaves before the response arrives), except through "Retry" below.
- While the request is in flight the page shows "Loading courses…". If it fails (a network error or a non-2xx response), the page shows "Couldn't load courses." and a "Retry" button that sends the request again.
- Show each course as an `li.course` with its title, "N seats left" and an "Enroll" button. Enrolling takes a seat (the number goes down by one) and the button becomes "Leave"; "Leave" gives the seat back. A course with no seats left that the user is not enrolled in shows a disabled "Full" button instead.
- The header shows "N enrolled" in `.enrolled-count` on every page (it starts at "0 enrolled").
- The Profile page lists the titles of the courses the user is enrolled in, as `li` items of a `ul.my-courses`, in the same order as the course list. With no enrollments it shows "No courses yet." instead.
- Enrollments and seat numbers are kept when switching between pages.

Everything that works today (switching tabs, the Home page greeting, editing the name on the Profile page) must keep working.
