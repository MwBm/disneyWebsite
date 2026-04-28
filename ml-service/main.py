from fastapi import FastAPI, HTTPException
from schemas import PredictRequest, PredictResponse
from model import predict_for_date

app = FastAPI(title="Disney ML Service")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if not req.rides:
        raise HTTPException(status_code=422, detail="rides must not be empty")

    forecasts, crowd_score = predict_for_date(req.rides, req.target_date)

    return PredictResponse(forecasts=forecasts, crowd_score=crowd_score)
