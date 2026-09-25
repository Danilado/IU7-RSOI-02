function canBorrow(activeReservations, stars) {
  return activeReservations < stars;
}

function ratingDelta(isLate, conditionUnchanged) {
  if (isLate || !conditionUnchanged) {
    return -10 * (Number(isLate) + Number(!conditionUnchanged));
  }
  return 1;
}

module.exports = { canBorrow, ratingDelta };
