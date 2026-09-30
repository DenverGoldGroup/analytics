// Standing attendee projection rule — expected accretion and attrition by the event start date.
// One home for it: the attendees view and the Analyst Briefing both read from here.
//   Before the event (registrations):
//     Buy-Side & Sell-Side: x1.11 until the Friday before the event starts, x1.035 from that Friday on
//     Delegates: x0.98          Everyone else: x1.0
//   Once check-ins are reported (who actually attended):
//     Buy-Side participants: x1.035, for on-site colleagues who were not badged   Everyone else: x1.0
//   Staff (category "Staff") stay in the total, reported as "Other" rather than as participants.
(function(root) {
  var BUYSELL_EARLY = 1.11, BUYSELL_LATE = 1.035, DELEGATE = 0.98, OTHER = 1.0;
  var CHECKED_IN_BUYSIDE = 1.035;

  // The Buy/Sell-Side multiplier in effect on `today`, given the event start date (YYYY-MM-DD)
  function buySellMult(eventStartDate, today) {
    if (!eventStartDate) return BUYSELL_LATE;
    var friday = new Date(String(eventStartDate).slice(0, 10) + 'T00:00:00');
    do { friday.setDate(friday.getDate() - 1); } while (friday.getDay() !== 5); // walk back to the prior Friday
    var day = today ? new Date(today) : new Date();
    day.setHours(0, 0, 0, 0);
    return day < friday ? BUYSELL_EARLY : BUYSELL_LATE;
  }

  function isAttended(a) {
    return String(a.invitation_status || a.attendance || '').toLowerCase() === 'attended';
  }

  function isStaff(a) {
    return String(a.category || '').toLowerCase() === 'staff' || String(a.type || '').toLowerCase() === 'staff';
  }

  // True once the event has started and the list carries check-ins: counts are then actuals, not projections
  function checkedIn(list, eventStartDate, today) {
    if (!eventStartDate || !list || !list.length) return false;
    var day = today ? new Date(today) : new Date();
    var start = new Date(String(eventStartDate).slice(0, 10) + 'T00:00:00');
    day.setHours(0, 0, 0, 0);
    if (day < start) return false;
    for (var i = 0; i < list.length; i++) if (isAttended(list[i])) return true;
    return false;
  }

  // Per-attendee factor. `mode` is 'checked-in' for actuals; anything else is the pre-event projection.
  function factor(a, mult, mode) {
    if (mode === 'checked-in') {
      return a.type !== 'Delegate' && a.category === 'Buy-Side' ? CHECKED_IN_BUYSIDE : OTHER;
    }
    if (a.type === 'Delegate') return DELEGATE;
    if (a.category === 'Buy-Side' || a.category === 'Sell-Side') return mult;
    return OTHER;
  }

  // Headcount for a set of attendees, summing each attendee's factor
  function projectedCount(list, mult, mode) {
    var s = 0;
    for (var i = 0; i < list.length; i++) s += factor(list[i], mult, mode);
    return Math.round(s);
  }

  var api = { buySellMult: buySellMult, factor: factor, projectedCount: projectedCount,
    checkedIn: checkedIn, isAttended: isAttended, isStaff: isStaff,
    BUYSELL_EARLY: BUYSELL_EARLY, BUYSELL_LATE: BUYSELL_LATE, DELEGATE: DELEGATE, OTHER: OTHER,
    CHECKED_IN_BUYSIDE: CHECKED_IN_BUYSIDE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AttendeeProjection = api;
})(typeof window !== 'undefined' ? window : this);
