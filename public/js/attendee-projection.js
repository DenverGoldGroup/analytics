// Standing attendee projection rule — expected accretion and attrition by the event start date.
// One home for it: the attendees view and the Analyst Briefing both read from here.
//   Buy-Side & Sell-Side: x1.11 until the Friday before the event starts, x1.035 from that Friday on
//   Delegates: x0.98          Everyone else: x1.0
(function(root) {
  var BUYSELL_EARLY = 1.11, BUYSELL_LATE = 1.035, DELEGATE = 0.98, OTHER = 1.0;

  // The Buy/Sell-Side multiplier in effect on `today`, given the event start date (YYYY-MM-DD)
  function buySellMult(eventStartDate, today) {
    if (!eventStartDate) return BUYSELL_LATE;
    var friday = new Date(String(eventStartDate).slice(0, 10) + 'T00:00:00');
    do { friday.setDate(friday.getDate() - 1); } while (friday.getDay() !== 5); // walk back to the prior Friday
    var day = today ? new Date(today) : new Date();
    day.setHours(0, 0, 0, 0);
    return day < friday ? BUYSELL_EARLY : BUYSELL_LATE;
  }

  function factor(a, mult) {
    if (a.type === 'Delegate') return DELEGATE;
    if (a.category === 'Buy-Side' || a.category === 'Sell-Side') return mult;
    return OTHER;
  }

  // Projected headcount for a set of attendees, summing each attendee's class factor
  function projectedCount(list, mult) {
    var s = 0;
    for (var i = 0; i < list.length; i++) s += factor(list[i], mult);
    return Math.round(s);
  }

  var api = { buySellMult: buySellMult, factor: factor, projectedCount: projectedCount,
    BUYSELL_EARLY: BUYSELL_EARLY, BUYSELL_LATE: BUYSELL_LATE, DELEGATE: DELEGATE, OTHER: OTHER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AttendeeProjection = api;
})(typeof window !== 'undefined' ? window : this);
