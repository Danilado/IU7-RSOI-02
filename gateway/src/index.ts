import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { canBorrow, ratingDelta } from "./rules";

interface ServiceUrls {
  library: string;
  reservation: string;
  rating: string;
}

interface ApiError extends Error {
  status?: number;
  payload?: unknown;
}

interface BookLibrary {
  bookUid: string;
  name: string;
  author: string | null;
  genre: string | null;
  condition: string;
  libraryUid: string;
  libraryName: string;
  city: string;
  address: string;
  availableCount: number;
}

interface Reservation {
  reservationUid: string;
  username: string;
  bookUid: string;
  libraryUid: string;
  status: string;
  startDate: string;
  tillDate: string;
  rentedCondition: string;
}

interface Rating {
  stars: number;
}

interface ReservationRequest {
  bookUid: string;
  libraryUid: string;
  tillDate: string;
}

interface ReturnRequest {
  condition: string;
  date: string;
}

const app = express();
app.use(express.json());

const urls: ServiceUrls = {
  library: process.env.LIBRARY_URL ?? "http://library-service:8060",
  reservation: process.env.RESERVATION_URL ?? "http://reservation-service:8070",
  rating: process.env.RATING_URL ?? "http://rating-service:8050",
};

async function call<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
  });
  const data: unknown =
    response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const body = data as { message?: string } | null;
    const error: ApiError = new Error(
      body?.message ?? "Upstream request failed",
    );
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data as T;
}

function query(
  values: Record<string, string | number | boolean | undefined>,
): string {
  return new URLSearchParams(
    Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}

function username(request: {
  get(name: string): string | undefined;
}): string | undefined {
  return request.get("X-User-Name");
}

function queryString(request: Request, key: string): string | undefined {
  const value = request.query[key];
  return typeof value === "string" ? value : undefined;
}

app.get("/manage/health", (_request, response) => response.sendStatus(200));

app.get("/api/v1/libraries", async (request, response, next) => {
  try {
    const city = queryString(request, "city");
    if (!city) {
      return response.status(400).json({ message: "city is required" });
    }

    const params = query({
      city,
      page: queryString(request, "page") ?? "1",
      size: queryString(request, "size") ?? "10",
    });
    const result = await call<unknown>(
      `${urls.library}/internal/libraries?${params}`,
    );
    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/v1/libraries/:uid/books", async (request, response, next) => {
  try {
    const params = query({
      page: queryString(request, "page") ?? "1",
      size: queryString(request, "size") ?? "25",
      showAll: queryString(request, "showAll") ?? false,
    });
    const result = await call<unknown>(
      `${urls.library}/internal/libraries/${request.params.uid}/books?${params}`,
    );
    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/v1/rating", async (request, response, next) => {
  try {
    const user = username(request);
    if (!user) {
      return response.status(400).json({ message: "X-User-Name is required" });
    }

    const rating = await call<Rating>(
      `${urls.rating}/internal/rating/${encodeURIComponent(user)}`,
    );
    return response.json(rating);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/v1/reservations", async (request, response, next) => {
  try {
    const user = username(request);
    if (!user) {
      return response.status(400).json({ message: "X-User-Name is required" });
    }

    const reservations = await call<Reservation[]>(
      `${urls.reservation}/internal/reservations?username=${encodeURIComponent(user)}`,
    );
    const result = await Promise.all(
      reservations.map(async (reservation) => {
        const book = await call<BookLibrary>(
          `${urls.library}/internal/books/${reservation.bookUid}/libraries/${reservation.libraryUid}`,
        );
        return {
          reservationUid: reservation.reservationUid,
          status: reservation.status,
          startDate: reservation.startDate,
          tillDate: reservation.tillDate,
          book: {
            bookUid: book.bookUid,
            name: book.name,
            author: book.author,
            genre: book.genre,
          },
          library: {
            libraryUid: book.libraryUid,
            name: book.libraryName,
            address: book.address,
            city: book.city,
          },
        };
      }),
    );
    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/api/v1/reservations",
  async (
    request: Request<object, unknown, ReservationRequest>,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const user = username(request);
      const { bookUid, libraryUid, tillDate } = request.body ?? {};
      if (!user || !bookUid || !libraryUid || !tillDate) {
        return response.status(400).json({
          message: "X-User-Name, bookUid, libraryUid and tillDate are required",
        });
      }

      const active = await call<Reservation[]>(
        `${urls.reservation}/internal/reservations?username=${encodeURIComponent(user)}`,
      );
      const rating = await call<Rating>(
        `${urls.rating}/internal/rating/${encodeURIComponent(user)}`,
      );
      if (!canBorrow(active.length, rating.stars)) {
        return response
          .status(400)
          .json({ message: "Active reservation limit reached" });
      }

      const book = await call<BookLibrary>(
        `${urls.library}/internal/books/${bookUid}/libraries/${libraryUid}`,
      );
      await call<unknown>(
        `${urls.library}/internal/books/${bookUid}/libraries/${libraryUid}/checkout`,
        { method: "POST" },
      );

      let reservation: Reservation;
      try {
        reservation = await call<Reservation>(
          `${urls.reservation}/internal/reservations`,
          {
            method: "POST",
            body: JSON.stringify({
              username: user,
              bookUid,
              libraryUid,
              tillDate,
              condition: book.condition,
            }),
          },
        );
      } catch (error) {
        await call<unknown>(
          `${urls.library}/internal/books/${bookUid}/libraries/${libraryUid}/return`,
          { method: "POST" },
        ).catch(() => undefined);
        throw error;
      }

      return response.json({
        reservationUid: reservation.reservationUid,
        status: reservation.status,
        startDate: reservation.startDate,
        tillDate: reservation.tillDate,
        book: {
          bookUid: book.bookUid,
          name: book.name,
          author: book.author,
          genre: book.genre,
        },
        library: {
          libraryUid: book.libraryUid,
          name: book.libraryName,
          address: book.address,
          city: book.city,
        },
        rating,
      });
    } catch (error) {
      return next(error);
    }
  },
);

app.post(
  "/api/v1/reservations/:uid/return",
  async (
    request: Request<{ uid: string }, unknown, ReturnRequest>,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const user = username(request);
      const { condition, date } = request.body ?? {};
      if (!user || !condition || !date) {
        return response.status(400).json({
          message: "X-User-Name, condition and date are required",
        });
      }

      const reservation = await call<Reservation>(
        `${urls.reservation}/internal/reservations/${request.params.uid}?username=${encodeURIComponent(user)}`,
      );
      await call<Reservation>(
        `${urls.reservation}/internal/reservations/${request.params.uid}/return`,
        {
          method: "POST",
          body: JSON.stringify({ username: user, date, condition }),
        },
      );
      await call<unknown>(
        `${urls.library}/internal/books/${reservation.bookUid}/libraries/${reservation.libraryUid}/return`,
        { method: "POST" },
      );

      const isLate = new Date(date) > new Date(reservation.tillDate);
      const conditionUnchanged = condition === reservation.rentedCondition;
      const delta = ratingDelta(isLate, conditionUnchanged);
      await call<Rating>(
        `${urls.rating}/internal/rating/${encodeURIComponent(user)}/change`,
        { method: "POST", body: JSON.stringify({ delta }) },
      );
      return response.sendStatus(204);
    } catch (error) {
      return next(error);
    }
  },
);

app.use(
  (
    error: ApiError,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    console.error(error);
    return response
      .status(error.status ?? 500)
      .json(
        error.payload ?? { message: error.message ?? "Internal server error" },
      );
  },
);

app.listen(8080, "127.0.0.1");
