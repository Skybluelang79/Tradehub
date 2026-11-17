from fastapi import APIRouter, Body, Depends

from .. import orders_service
from ..deps import require_user

router = APIRouter()


@router.get("")
def list_orders(role: str = "all", user: dict = Depends(require_user)):
    selected = role if role in ("all", "buyer", "seller") else "all"
    return {"orders": orders_service.list_orders(user, selected), "role": selected}


@router.get("/{order_id}")
def get_order(order_id: str, user: dict = Depends(require_user)):
    return {"order": orders_service.order_detail(order_id, user)}


@router.post("/{order_id}/shipments", status_code=201)
def create_shipment(
    order_id: str,
    body: dict = Body(...),
    user: dict = Depends(require_user),
):
    return {"order": orders_service.create_shipment(order_id, user, body)}


@router.put("/{order_id}/shipments/{shipment_id}")
def update_shipment(
    order_id: str,
    shipment_id: str,
    body: dict = Body(...),
    user: dict = Depends(require_user),
):
    return {"order": orders_service.update_shipment(order_id, shipment_id, user, body)}


@router.post("/{order_id}/confirm-delivery")
def confirm_delivery(order_id: str, user: dict = Depends(require_user)):
    return {"order": orders_service.confirm_delivery(order_id, user)}
